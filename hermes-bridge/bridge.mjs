#!/usr/bin/env node
/**
 * Hermy HQ ↔ Hermes bridge.
 *
 * Runs on the Mac mini where Hermes lives. Talks to the shared Postgres
 * (the same DATABASE_URL the website uses) — nothing is exposed to the
 * internet. Two jobs:
 *
 *   PULL  (Hermes → website): mirror the kanban board into HermesTask,
 *         cron list + health into DataStore, and emit activity events.
 *   PUSH  (website → Hermes): pick up AgentRequest rows that are `queued`
 *         (safe) or `approved` (human-approved side-effecting), run them
 *         through the `hermes` CLI, and write results back.
 *
 * Requires: the `hermes` binary on PATH, and env DATABASE_URL.
 * Optional env: HERMES_BOARD (default "default"), BRIDGE_POLL_MS (5000),
 *               BRIDGE_MIRROR_MS (30000), HERMES_BIN (default "hermes").
 */
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const execFileP = promisify(execFile);
const HERMES = process.env.HERMES_BIN || "hermes";
const BOARD = process.env.HERMES_BOARD || "default";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 5000);
const MIRROR_MS = Number(process.env.BRIDGE_MIRROR_MS || 30000);
const RUN_TIMEOUT_MS = Number(process.env.BRIDGE_RUN_TIMEOUT_MS || 240000);
const WIKI_DIR = process.env.HERMES_WIKI || path.join(os.homedir(), ".hermes", "wiki");
const MEMORY_NAMESPACE = process.env.HERMES_MEMORY_NAMESPACE || "default";
const BRIEF_HOUR = Number(process.env.BRIEF_HOUR || 8);   // local hour to auto-generate the daily brief
const BRIEF_PROMPT =
  "You are the operator's chief of staff. Produce today's brief. Read your memory wiki open-loops " +
  "(~/.hermes/wiki), the kanban board, and recent activity. Output ONLY valid JSON (no prose, no code fences) " +
  'in exactly this shape: {"greeting":"one warm line","summary":"2-3 sentences on where things stand",' +
  '"sections":[{"label":"Needs your decision","items":["..."]},{"label":"Top priorities","items":["..."]},' +
  '{"label":"Recently shipped","items":["..."]},{"label":"Next actions","items":["..."]}]}. ' +
  "Keep every item short, concrete, and specific. Omit a section if it has nothing.";
let lastBriefDate = null;

const DB_URL = process.env.DATABASE_URL || "";
// Cloud Postgres (Prisma Postgres/Neon/Supabase/RDS) needs SSL; localhost doesn't.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(DB_URL);
const pool = new pg.Pool({ connectionString: DB_URL, max: 4, ssl: isLocal ? undefined : { rejectUnauthorized: false } });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const q = (text, params) => pool.query(text, params);

async function hermes(args, { timeout = 30000 } = {}) {
  const { stdout } = await execFileP(HERMES, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function emit(kind, title, { detail = null, agent = "hermes", level = "info", meta = null } = {}) {
  await q(
    `INSERT INTO "AgentEvent" (id, kind, title, detail, agent, level, meta, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [randomUUID(), kind, title.slice(0, 200), detail, agent, level, meta ? JSON.stringify(meta) : null]
  );
}

async function setStore(key, data) {
  await q(
    `INSERT INTO "DataStore" (key, data, "updatedAt") VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
    [key, JSON.stringify(data)]
  );
}

/* ─────────────── PULL: mirror Hermes → Postgres ─────────────── */
async function mirrorKanban() {
  let tasks = [];
  try {
    // NB: this Hermes CLI wants --board BEFORE the subcommand.
    const out = await hermes(["kanban", "--board", BOARD, "list", "--json"], { timeout: 15000 });
    const parsed = JSON.parse(out || "[]");
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch (e) { log("kanban list failed:", e.message.split("\n")[0]); return; }

  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id ?? t.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, "syncedAt"=now()`,
      [id, BOARD, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null]
    );
  }
  // prune tasks that vanished from the board
  if (seen.size) {
    await q(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [BOARD, [...seen]]);
  } else {
    await q(`DELETE FROM "HermesTask" WHERE board=$1`, [BOARD]);
  }
}

async function mirrorCrons() {
  try {
    const out = await hermes(["cron", "list", "--all"], { timeout: 15000 });
    const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    await setStore("hermes-crons", { jobs: lines, raw: out.slice(0, 8000), syncedAt: new Date().toISOString() });
  } catch (e) { log("cron list failed:", e.message.split("\n")[0]); }
}

async function mirrorCost() {
  for (const args of [["insights", "--days", "7"], ["insights"]]) {
    try {
      const out = await hermes(args, { timeout: 15000 });
      await setStore("hermes-cost", { summary: out.slice(0, 4000), syncedAt: new Date().toISOString() });
      return;
    } catch { /* try next arg shape */ }
  }
}

async function mirrorHealth() {
  let online = false, gateway = "unknown", detail = "";
  try {
    const out = await hermes(["status"], { timeout: 12000 });
    detail = out.slice(0, 4000);
    online = /online|running|connected/i.test(out);
    gateway = /gateway[^\n]*(running|online)/i.test(out) ? "running" : "stopped";
  } catch (e) { detail = e.message.split("\n")[0]; }
  await setStore("hermes-health", { online, gateway, detail, lastSeen: new Date().toISOString() });
}

/* ─────────────── Memory Wiki (warm tier: git-tracked markdown) ─────────────── */
function parseEntry(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  let fm = {}; let body = md;
  if (m) {
    body = m[2];
    const parsed = YAML.parse(m[1], { maxAliasCount: 0, uniqueKeys: true });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed;
  }
  return { fm, body: body.trim() };
}
function walkMd(dir, out = [], root = dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (it.isDirectory()) { if (it.name !== ".git") walkMd(full, out, root); }
    else if (it.name.endsWith(".md") && it.name !== "INDEX.md" && isWithin(root, full)) out.push(full);
  }
  return out;
}
async function mirrorWiki() {
  if (!fs.existsSync(WIKI_DIR)) return;
  const files = walkMd(WIKI_DIR);
  // An empty mounted wiki is ambiguous. Never translate it into a destructive purge.
  if (!files.length) { log("wiki scan empty; retaining mirrored memory"); return; }
  const seen = new Set();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
  for (const file of files) {
    const rel = path.relative(WIKI_DIR, file);
    let raw = ""; try { raw = fs.readFileSync(file, "utf8"); } catch { continue; }
    const { fm, body } = parseEntry(raw);
    const fallbackId = rel.replace(/\.md$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const id = typeof fm.id === "string" && /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(fm.id) ? fm.id : fallbackId;
    if (!id) throw new Error(`wiki entry has no canonical id: ${rel}`);
    seen.add(id);
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    await client.query(
      `INSERT INTO "HermesMemory" (namespace, id, path, type, title, status, confidence, trust, provenance, "sourceUri", "supersedesId", revision, "contentHash", tags, links, body, "validFrom", "validTo", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now(), now())
       ON CONFLICT (namespace, id) DO UPDATE SET path=EXCLUDED.path, type=EXCLUDED.type, title=EXCLUDED.title,
         status=EXCLUDED.status, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance,
         trust=EXCLUDED.trust, "sourceUri"=EXCLUDED."sourceUri", "supersedesId"=EXCLUDED."supersedesId",
         revision=EXCLUDED.revision, "contentHash"=EXCLUDED."contentHash", tags=EXCLUDED.tags,
         links=EXCLUDED.links, body=EXCLUDED.body, "validFrom"=EXCLUDED."validFrom",
         "validTo"=EXCLUDED."validTo", "updatedAt"=now(), "syncedAt"=now()`,
      [MEMORY_NAMESPACE, id, rel, fm.type || "fact", fm.title || id, fm.status || "active", fm.confidence || null,
       fm.trust || "untrusted", fm.provenance || null, fm.source_uri || null, fm.supersedes_id || null,
       Number(fm.revision) || 1, hash, Array.isArray(fm.tags) ? fm.tags : [], Array.isArray(fm.links) ? fm.links : [],
       body, fm.valid_from || null, fm.valid_to || null]
    );
  }
  await client.query(`DELETE FROM "HermesMemory" WHERE namespace=$1 AND id <> ALL($2::text[])`, [MEMORY_NAMESPACE, [...seen]]);
  await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function assertMemoryEntry(e) {
  if (!e || typeof e !== "object") throw new Error("invalid memory payload");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(e.id || "")) throw new Error("invalid memory id");
  if (!/^[a-z]+s\/[a-z0-9-]+\.md$/.test(e.path || "")) throw new Error("invalid memory path");
  if (e.path !== `${e.type}s/${e.id}.md`) throw new Error("memory path must be canonical");
  if (typeof e.title !== "string" || !e.title.trim() || e.title.length > 200) throw new Error("invalid memory title");
  if (typeof e.body !== "string" || e.body.length > 100_000) throw new Error("invalid memory body");
}
function writeWikiEntry(e) {
  assertMemoryEntry(e);
  const rel = e.path;
  const full = path.resolve(WIKI_DIR, rel);
  if (!isWithin(WIKI_DIR, full)) throw new Error("memory path escapes wiki root");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const parentReal = fs.realpathSync(path.dirname(full));
  if (!isWithin(WIKI_DIR, parentReal)) throw new Error("memory directory escapes wiki root");
  if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) throw new Error("refusing to write through symlink");
  const now = new Date().toISOString().slice(0, 10);
  const previous = fs.existsSync(full) ? parseEntry(fs.readFileSync(full, "utf8")).fm : {};
  const frontmatter = {
    id: e.id, type: e.type, title: e.title, status: e.status,
    confidence: e.confidence, trust: e.trust, provenance: e.provenance,
    source_uri: e.sourceUri, supersedes_id: e.supersedesId,
    tags: e.tags || [], links: e.links || [], valid_from: e.validFrom,
    valid_to: e.validTo, revision: (Number(previous.revision) || 0) + 1, updated: now,
  };
  const content = `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${e.body || ""}\n`;
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temp, full);
  return rel;
}
async function gitCommitWiki(msg) {
  if (!fs.existsSync(path.join(WIKI_DIR, ".git"))) await execFileP("git", ["-C", WIKI_DIR, "init"]);
  await execFileP("git", ["-C", WIKI_DIR, "add", "-A"]);
  try { await execFileP("git", ["-C", WIKI_DIR, "commit", "-m", msg]); }
  catch (error) {
    const status = await execFileP("git", ["-C", WIKI_DIR, "status", "--porcelain"]);
    if (status.stdout.trim()) throw error;
  }
}

/* ─────────────── Chief-of-staff daily brief ─────────────── */
async function generateBriefing() {
  const raw = (await hermes(["-z", BRIEF_PROMPT], { timeout: RUN_TIMEOUT_MS })).trim();
  let brief;
  try {
    const jsonStr = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const m = jsonStr.match(/\{[\s\S]*\}/);
    brief = JSON.parse(m ? m[0] : jsonStr);
  } catch { brief = { summary: raw.slice(0, 1500), sections: [] }; }
  brief.generatedAt = new Date().toISOString();
  await setStore("hermes-briefing", brief);
  await emit("status", "Daily brief generated", { level: "up" });
}
async function maybeDailyBrief() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() >= BRIEF_HOUR && lastBriefDate !== today) {
    lastBriefDate = today;
    try { await generateBriefing(); } catch (e) { log("daily brief err", e.message); }
  }
}

/* ─────────────── PUSH: run website requests via Hermes ─────────────── */
async function runRequest(r) {
  await q(`UPDATE "AgentRequest" SET status='running', "startedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id]);
  await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  try {
    let result = "";
    if (r.kind === "oneshot" || r.kind === "chat") {
      result = (await hermes(["-z", r.prompt || r.title], { timeout: RUN_TIMEOUT_MS })).trim();
    } else if (r.kind === "kanban") {
      result = (await hermes(["kanban", "--board", BOARD, "create", "--json", r.title], { timeout: 20000 })).trim();
    } else if (r.kind.startsWith("cron.")) {
      const op = r.kind.split(".")[1];
      const a = JSON.parse(r.prompt || "{}");
      const argv =
        op === "create" ? ["cron", "create", a.schedule, a.prompt || a.name].filter(Boolean)
        : op === "run"    ? ["cron", "run", a.id || a.name]
        : op === "pause"  ? ["cron", "pause", a.id || a.name]
        : op === "resume" ? ["cron", "resume", a.id || a.name]
        : op === "remove" ? ["cron", "remove", a.id || a.name]
        : op === "edit"   ? ["cron", "edit", a.id || a.name]
        : null;
      if (!argv) throw new Error(`unknown cron op ${op}`);
      result = (await hermes(argv, { timeout: 20000 })).trim();
      await mirrorCrons();
    } else if (r.kind === "memory.write") {
      const e = JSON.parse(r.prompt || "{}");
      const rel = writeWikiEntry(e);
      await gitCommitWiki(`wiki: update ${rel} (via dashboard)`);
      await mirrorWiki();
      result = `wrote ${rel}`;
    } else if (r.kind === "briefing.generate") {
      await generateBriefing();
      lastBriefDate = new Date().toISOString().slice(0, 10);
      result = "brief updated";
    } else {
      throw new Error(`unknown kind ${r.kind}`);
    }
    await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
      [r.id, result.slice(0, 8000)]);
    await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
  } catch (e) {
    const msg = (e.stderr || e.message || "error").toString().split("\n")[0].slice(0, 600);
    await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id, msg]);
    await emit("run", `Failed: ${r.title}`, { level: "down", detail: msg, meta: { requestId: r.id } });
    log("request failed:", r.id, msg);
  }
}

async function processQueue() {
  const { rows } = await q(`
    UPDATE "AgentRequest" SET status='running', "startedAt"=now(), "updatedAt"=now()
    WHERE id IN (
      SELECT id FROM "AgentRequest" WHERE status IN ('queued','approved')
      ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 3
    ) RETURNING *
  `);
  for (const r of rows) await runRequest(r);
}

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorWiki(); } catch (e) { log("mirrorWiki err", e.message); }
  try { await mirrorCost(); } catch (e) { log("mirrorCost err", e.message); }
  try { await maybeDailyBrief(); } catch (e) { log("maybeDailyBrief err", e.message); }
}

async function main() {
  if (!DB_URL) throw new Error("DATABASE_URL is required (use a direct postgres:// URL)");
  if (DB_URL.startsWith("prisma://") || DB_URL.startsWith("prisma+")) {
    throw new Error("DATABASE_URL must be a direct postgres:// connection, not Prisma Accelerate");
  }
  log(`hermes-bridge up · board=${BOARD} · poll=${POLL_MS}ms · mirror=${MIRROR_MS}ms`);
  await emit("status", "Bridge connected", { level: "up" });
  await mirrorTick();
  setInterval(() => mirrorTick().catch((e) => log("mirror loop", e.message)), MIRROR_MS);
  // queue loop
  const tick = async () => { try { await processQueue(); } catch (e) { log("queue loop", e.message); } finally { setTimeout(tick, POLL_MS); } };
  tick();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error("fatal", e); process.exit(1); });
}

export { assertMemoryEntry, isWithin, parseEntry, writeWikiEntry };
