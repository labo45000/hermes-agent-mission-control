import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memoryRelevance, parseMemoryInput } from "@/lib/memory";

const namespace = process.env.HERMES_MEMORY_NAMESPACE || "default";

// GET ?q=&type=&status= → list/search wiki entries (mirrored by the bridge)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status") || "active";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 300);
  const where: Record<string, unknown> = { namespace };
  if (status !== "all") where.status = status;
  if (type && type !== "all") where.type = type;
  if (q) where.OR = [
    { title: { contains: q, mode: "insensitive" } },
    { body: { contains: q, mode: "insensitive" } },
    { tags: { has: q.toLowerCase() } },
  ];
  const candidates = await prisma.hermesMemory.findMany({ where, orderBy: { updatedAt: "desc" }, take: q ? 1000 : limit });
  const entries = q
    ? candidates.map((entry) => ({ entry, score: memoryRelevance(entry, q) }))
      .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score)
      .slice(0, limit).map(({ entry }) => entry)
    : candidates;
  const countWhere = status === "all" ? { namespace } : { namespace, status };
  const all = await prisma.hermesMemory.findMany({ select: { type: true }, where: countWhere });
  const typeCounts: Record<string, number> = {};
  for (const e of all) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  const latest = await prisma.hermesMemory.findFirst({ where: { namespace }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } });
  const lastSync = latest?.syncedAt ?? null;
  return NextResponse.json({ entries, typeCounts, total: all.length, lastSync });
}

// POST { id?, type, title, body, tags?, links?, status?, confidence?, trust? }
// → queue an approval-gated wiki write. Client-supplied paths are never accepted.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  let entry;
  try {
    entry = { ...parseMemoryInput(b), namespace };
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid memory" }, { status: 400 });
  }
  const existing = await prisma.hermesMemory.findUnique({ where: { namespace_id: { namespace, id: entry.id } }, select: { type: true } });
  if (existing && existing.type !== entry.type) {
    return NextResponse.json({ error: "memory type cannot change in place; supersede it with a new entry" }, { status: 409 });
  }
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "memory.write",
      title: `Memory: ${entry.title}`.slice(0, 200),
      prompt: JSON.stringify(entry),
      sideEffecting: true,
      status: "awaiting_approval",
    },
  });
  return NextResponse.json({ request: row, entry });
}
