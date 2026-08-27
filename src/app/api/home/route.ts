import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PROFILE_STORE_KEY,
  buildProfileRoster,
  evidenceFromRows,
  evidenceFromValue,
  type Evidence,
  type ProfileInput,
} from "@/lib/personal-dashboard";

export const dynamic = "force-dynamic";

// Bridge mirrors every 30 seconds. Two minutes tolerates two missed cycles plus jitter.
export const HEALTH_FRESH_MS = 120_000;
export const PROFILE_FRESH_MS = 120_000;
// Kanban work changes less frequently; activity is useful for a slightly longer window.
export const TASK_FRESH_MS = 5 * 60_000;
export const EVENT_FRESH_MS = 15 * 60_000;

type Domain = {
  id: string;
  title: string;
  description: string;
  href: string | null;
  evidence: Evidence<unknown>[];
};

const unavailable = (source: string): Evidence<never> => ({
  value: null,
  status: "unavailable",
  source,
  updatedAt: null,
});

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export async function GET() {
  const now = new Date();
  const results = await Promise.allSettled([
    prisma.dataStore.findUnique({ where: { key: "hermes-health" } }),
    prisma.dataStore.findUnique({ where: { key: PROFILE_STORE_KEY } }),
    prisma.hermesTask.findMany({ orderBy: { syncedAt: "desc" }, take: 20 }),
    prisma.agentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.dataStore.findMany({ select: { key: true, updatedAt: true } }),
    prisma.draft.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.youtubeIdea.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    prisma.article.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.hermesMemory.aggregate({ _count: true, _max: { syncedAt: true } }),
    prisma.agentRequest.aggregate({ where: { status: "awaiting_approval" }, _count: { _all: true }, _max: { updatedAt: true } }),
  ]);

  const healthRow = fulfilled(results[0]);
  const profileRow = fulfilled(results[1]);
  const tasks = fulfilled(results[2]);
  const events = fulfilled(results[3]);
  const storeRows = fulfilled(results[4]);
  const draftSummary = fulfilled(results[5]);
  const youtubeIdeaSummary = fulfilled(results[6]);
  const articleSummary = fulfilled(results[7]);
  const memory = fulfilled(results[8]);
  const approvalSummary = fulfilled(results[9]);

  const profileData = profileRow?.data as { profiles?: ProfileInput[]; syncedAt?: string } | undefined;
  const profileTimestamp = profileData?.syncedAt ? new Date(profileData.syncedAt) : profileRow?.updatedAt;
  const profiles = buildProfileRoster(profileData?.profiles ?? []);

  const health = healthRow
    ? evidenceFromValue(healthRow.data, "DataStore/hermes-health", healthRow.updatedAt, HEALTH_FRESH_MS, now)
    : unavailable("DataStore/hermes-health");
  const profileMirror = profileRow
    ? evidenceFromValue(profiles, `DataStore/${PROFILE_STORE_KEY}`, profileTimestamp, PROFILE_FRESH_MS, now)
    : unavailable(`DataStore/${PROFILE_STORE_KEY}`);
  const activeWork = evidenceFromRows(tasks, "HermesTask", (task) => task.syncedAt, TASK_FRESH_MS, now);
  const activity = evidenceFromRows(events, "AgentEvent", (event) => event.createdAt, EVENT_FRESH_MS, now);

  const storeKeyEvidence = (matcher: (key: string) => boolean, source: string) => {
    if (!storeRows) return unavailable(source);
    const matching = storeRows.filter((row) => matcher(row.key));
    if (matching.length === 0) return unavailable(source);
    return evidenceFromValue(
      { configuredKeys: matching.map((row) => row.key) },
      source,
      matching.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null),
      TASK_FRESH_MS,
      now,
    );
  };
  const profilesFor = (...groups: string[]) => profiles.filter((profile) => groups.includes(profile.group));
  const activeTasksFor = (...assignees: string[]) => (tasks ?? []).filter((task) =>
    assignees.includes(task.assignee ?? "") && !["done", "completed", "cancelled"].includes(task.status.toLowerCase()),
  );

  const contentUpdatedAt = [draftSummary?._max.updatedAt, youtubeIdeaSummary?._max.createdAt, articleSummary?._max.updatedAt]
    .filter((value): value is Date => value instanceof Date)
    .reduce<Date | null>((latest, value) => !latest || value > latest ? value : latest, null);
  const contentCounts = !draftSummary || !youtubeIdeaSummary || !articleSummary || !contentUpdatedAt
    ? unavailable("PostgreSQL Draft/YoutubeIdea/Article")
    : evidenceFromValue(
      { drafts: draftSummary._count._all, youtubeIdeas: youtubeIdeaSummary._count._all, articles: articleSummary._count._all },
      "PostgreSQL Draft/YoutubeIdea/Article",
      contentUpdatedAt,
      TASK_FRESH_MS,
      now,
    );
  const memoryEvidence = !memory || !memory._max.syncedAt
    ? unavailable("PostgreSQL HermesMemory")
    : evidenceFromValue(
      { count: memory._count, latestSyncedAt: memory._max.syncedAt.toISOString() },
      "PostgreSQL HermesMemory",
      memory._max.syncedAt,
      TASK_FRESH_MS,
      now,
    );
  const approvalEvidence = !approvalSummary || !approvalSummary._max.updatedAt
    ? unavailable("PostgreSQL AgentRequest approvals")
    : evidenceFromValue(
      { awaitingApproval: approvalSummary._count._all },
      "PostgreSQL AgentRequest approvals",
      approvalSummary._max.updatedAt,
      TASK_FRESH_MS,
      now,
    );
  const briefingEvidence = storeKeyEvidence((key) => key === "hermes-briefing", "DataStore/hermes-briefing");
  const commandUpdatedAt = [approvalEvidence.updatedAt, briefingEvidence.updatedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const commandStatus = approvalEvidence.status === "stale" || briefingEvidence.status === "stale"
    ? "stale"
    : approvalEvidence.status === "available" || briefingEvidence.status === "available"
      ? "available"
      : "unavailable";
  const command: Evidence<{ approvals: Evidence<unknown>; briefing: Evidence<unknown> }> = {
    value: commandStatus === "unavailable" ? null : { approvals: approvalEvidence, briefing: briefingEvidence },
    status: commandStatus,
    source: "AgentRequest approvals + DataStore/hermes-briefing",
    updatedAt: commandUpdatedAt,
  };

  const augmentLabel = process.env.AUGMENT_WORKSPACE_LABEL?.trim() || null;
  const augmentHref = process.env.AUGMENT_WORKSPACE_URL?.trim() || null;
  const augmentEvidence: Evidence<{ label: string; href: string | null }> = augmentLabel
    ? { value: { label: augmentLabel, href: augmentHref }, status: "available", source: "static AUGMENT_WORKSPACE_* configuration", updatedAt: null }
    : unavailable("static AUGMENT_WORKSPACE_* configuration");

  const domains: Domain[] = [
    {
      id: "command",
      title: "Command",
      description: "Approval and chief-of-staff brief evidence, timestamped from their persisted sources.",
      href: "/hermes",
      evidence: [command],
    },
    {
      id: "trading",
      title: "Trading",
      description: "Trading profile roster and configured DataStore evidence only; no inferred P&L or positions.",
      href: "/agents",
      evidence: [
        { ...profileMirror, value: profilesFor("Trading") },
        storeKeyEvidence((key) => /trading|polymarket|hyperliquid/i.test(key), "DataStore trading-related keys"),
      ],
    },
    {
      id: "builds",
      title: "Builds / AI",
      description: "Builder, AI Lab, and Ops Brain profile evidence plus active assigned Hermes work.",
      href: "/agents",
      evidence: [
        { ...profileMirror, value: profiles.filter((profile) => ["builder", "ailab", "opsbrain"].includes(profile.id)) },
        { ...activeWork, value: activeTasksFor("builder", "ailab", "opsbrain") },
      ],
    },
    {
      id: "content",
      title: "Content / OFM",
      description: "Content and OFM pods with counts read directly from production content tables.",
      href: "/ideas",
      evidence: [{ ...profileMirror, value: profilesFor("Content", "OFM") }, contentCounts],
    },
    {
      id: "augment",
      title: "AÜGMENT",
      description: "Workspace availability is configuration-only; no activity metrics are invented.",
      href: augmentHref,
      evidence: [augmentEvidence],
    },
    {
      id: "memory",
      title: "Memory",
      description: "Mirrored Hermes memory and requests currently waiting for human approval.",
      href: "/memory-wiki",
      evidence: [memoryEvidence, approvalEvidence],
    },
  ];

  return NextResponse.json(
    { owner: "Turbo", profiles, health, profileMirror, activeWork, activity, command, domains },
    { headers: { "Cache-Control": "no-store" } },
  );
}
