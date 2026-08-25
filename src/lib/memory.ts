export const MEMORY_TYPES = [
  "fact", "preference", "decision", "event", "project", "contact",
  "lesson", "metric", "note",
] as const;
export const MEMORY_STATUSES = ["active", "superseded", "archived", "quarantined"] as const;
export const MEMORY_CONFIDENCE = ["low", "medium", "high"] as const;
export const MEMORY_TRUST = ["untrusted", "reviewed", "authoritative"] as const;

type JsonRecord = Record<string, unknown>;

const MAX_TITLE = 200;
const MAX_BODY = 100_000;
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : fallback;
}

function strings(value: unknown, maxItems = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, maxItems))];
}

export function canonicalMemoryId(value: unknown, title: string): string {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ID_RE.test(candidate)) return candidate;
  const generated = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  if (!ID_RE.test(generated)) throw new Error("A valid memory id could not be generated");
  return generated;
}

export function parseMemoryInput(input: unknown) {
  const value: JsonRecord = input && typeof input === "object" && !Array.isArray(input) ? input as JsonRecord : {};
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title || title.length > MAX_TITLE) throw new Error(`title must be between 1 and ${MAX_TITLE} characters`);
  const body = typeof value.body === "string" ? value.body : "";
  if (body.length > MAX_BODY) throw new Error(`body must not exceed ${MAX_BODY} characters`);
  const id = canonicalMemoryId(value.id, title);
  const type = enumValue(value.type, MEMORY_TYPES, "note");
  return {
    id,
    // Paths are derived, never accepted from an HTTP client.
    path: `${type}s/${id}.md`,
    type,
    title,
    status: enumValue(value.status, MEMORY_STATUSES, "active"),
    confidence: enumValue(value.confidence, MEMORY_CONFIDENCE, "medium"),
    trust: enumValue(value.trust, MEMORY_TRUST, "reviewed"),
    provenance: typeof value.provenance === "string" ? value.provenance.slice(0, 500) : "dashboard",
    sourceUri: typeof value.sourceUri === "string" ? value.sourceUri.slice(0, 2_000) : null,
    supersedesId: typeof value.supersedesId === "string" && ID_RE.test(value.supersedesId) ? value.supersedesId : null,
    tags: strings(value.tags),
    links: strings(value.links),
    body,
    validFrom: parseDate(value.validFrom),
    validTo: parseDate(value.validTo),
  };
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid memory validity date");
  return date.toISOString();
}

export function memoryRelevance(entry: { title: string; body: string; tags: string[]; status: string; trust: string; updatedAt: Date }, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entry.updatedAt.getTime();
  const title = entry.title.toLowerCase();
  const body = entry.body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title === query.toLowerCase()) score += 20;
    if (title.includes(term)) score += 8;
    if (entry.tags.some((tag) => tag.includes(term))) score += 5;
    if (body.includes(term)) score += 1;
  }
  if (entry.trust === "authoritative") score += 3;
  if (entry.trust === "untrusted" || entry.status === "quarantined") score -= 100;
  return score;
}
