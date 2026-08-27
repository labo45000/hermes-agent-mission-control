export const PROFILE_STORE_KEY = "hermes-profiles:turbo-main-v1";
export const GARDEN_STORE_KEY = "garden:turbo-main-v1";

export const PROFILE_GROUPS = {
  Command: ["default", "opsbrain"],
  Trading: ["backtestvalidator", "polymarketstructure", "quantresearch", "tradingmanager", "tradingrisk"],
  "Build/AI": ["ailab", "builder"],
  Content: ["contentmanager", "contentqa", "editorialstrategy", "scriptcopy"],
  OFM: ["ofmcompliance", "ofmeditorial", "ofmmanager"],
  Canon: ["brandcanon", "personacanon"],
} as const;

export type ProfileStatus = "online" | "offline" | "unknown" | "error";
export type HermesRuntimeStatus = { label: string; tone: "online" | "offline" | "unknown" };

export function formatHermesRuntimeStatus(health: { online?: boolean } | null): HermesRuntimeStatus {
  if (!health) return { label: "Checking Hermes…", tone: "unknown" };
  return health.online
    ? { label: "Hermes reachable", tone: "online" }
    : { label: "Hermes unavailable", tone: "offline" };
}
export type ProfileInput = {
  name?: unknown;
  id?: unknown;
  status?: unknown;
  lastSeen?: unknown;
  updatedAt?: unknown;
};
export type ProfileCard = {
  id: string;
  profile: string;
  group: keyof typeof PROFILE_GROUPS;
  status: ProfileStatus;
  lastSeen: string | null;
  source: "hermes-profile-list" | "configured-roster";
};

export function normalizeProfileStatus(value: unknown): ProfileStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (["running", "online", "active", "healthy", "connected"].includes(normalized)) return "online";
  if (["failed", "error", "unhealthy"].includes(normalized)) return "error";
  if (["offline", "stopped", "disabled"].includes(normalized)) return "offline";
  return "unknown";
}

export function buildProfileRoster(input: ProfileInput[] = []): ProfileCard[] {
  const mapped = new Map(input.map((profile) => [String(profile.name ?? profile.id ?? ""), profile]));
  return Object.entries(PROFILE_GROUPS).flatMap(([group, names]) =>
    names.map((profile) => {
      const raw = mapped.get(profile);
      const seenAt = raw?.lastSeen ?? raw?.updatedAt;
      return {
        id: profile,
        profile,
        group: group as keyof typeof PROFILE_GROUPS,
        status: normalizeProfileStatus(raw?.status),
        lastSeen: typeof seenAt === "string" ? seenAt : null,
        source: raw ? "hermes-profile-list" : "configured-roster",
      };
    }),
  );
}

export type EvidenceStatus = "available" | "stale" | "unavailable";
export type Evidence<T> = {
  value: T | null;
  status: EvidenceStatus;
  source: string;
  updatedAt: string | null;
};

/** Freshness is measured from persisted source time; future timestamps fail closed as stale. */
export function evidenceFromValue<T>(
  value: T | null | undefined,
  source: string,
  updatedAt: Date | null | undefined,
  freshForMs: number,
  now = new Date(),
): Evidence<T> {
  if (value === null || value === undefined || !updatedAt) {
    return { value: null, status: "unavailable", source, updatedAt: null };
  }
  const age = now.getTime() - updatedAt.getTime();
  return {
    value,
    status: age >= 0 && age <= freshForMs ? "available" : "stale",
    source,
    updatedAt: updatedAt.toISOString(),
  };
}

export function evidenceFromRows<T>(
  rows: T[] | null | undefined,
  source: string,
  timestampOf: (row: T) => Date,
  freshForMs: number,
  now = new Date(),
): Evidence<T[]> {
  if (!rows?.length) return { value: null, status: "unavailable", source, updatedAt: null };
  const updatedAt = rows.reduce<Date | null>((latest, row) => {
    const timestamp = timestampOf(row);
    return !latest || timestamp > latest ? timestamp : latest;
  }, null);
  return evidenceFromValue(rows, source, updatedAt, freshForMs, now);
}

export type Plant = {
  id: string;
  name: string;
  emoji: string;
  location: "indoor" | "outdoor";
  waterSchedule: string;
  waterDays: number[];
  img?: string;
  tip?: string;
  addedBy?: string;
  addedAt: string;
};
export type Garden = { version: 1; revision: number; lastUpdated: string; plants: Plant[] };
export const GARDEN_EMPTY: Garden = { version: 1, revision: 0, lastUpdated: "", plants: [] };

type AddPlantInput = Omit<Plant, "id" | "addedAt">;
export type GardenOperation =
  | { action: "add"; expectedRevision: number; plant: AddPlantInput }
  | { action: "remove"; expectedRevision: number; id: string };

const hasExactKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => key in value);
const isText = (value: unknown, max: number, required = true) =>
  typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
const optionalText = (value: unknown, max: number) => value === undefined || isText(value, max, false);
const validDays = (value: unknown) =>
  Array.isArray(value) && value.length <= 7 && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);

function isPlant(value: unknown): value is Plant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plant = value as Record<string, unknown>;
  const required = ["id", "name", "emoji", "location", "waterSchedule", "waterDays", "addedAt"];
  const optional = ["img", "tip", "addedBy"];
  if (!Object.keys(plant).every((key) => [...required, ...optional].includes(key))) return false;
  if (!required.every((key) => key in plant)) return false;
  return (
    isText(plant.id, 80) &&
    isText(plant.name, 120) &&
    isText(plant.emoji, 16) &&
    ["indoor", "outdoor"].includes(String(plant.location)) &&
    isText(plant.waterSchedule, 120, false) &&
    validDays(plant.waterDays) &&
    isText(plant.addedAt, 40) &&
    !Number.isNaN(Date.parse(plant.addedAt as string)) &&
    optionalText(plant.img, 300) &&
    optionalText(plant.tip, 500) &&
    optionalText(plant.addedBy, 300)
  );
}

export function validateGarden(raw: unknown): { ok: true; value: Garden } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Garden must be an object" };
  const garden = raw as Record<string, unknown>;
  if (
    !hasExactKeys(garden, ["version", "revision", "lastUpdated", "plants"]) ||
    garden.version !== 1 ||
    !Number.isSafeInteger(garden.revision) ||
    Number(garden.revision) < 0 ||
    typeof garden.lastUpdated !== "string" ||
    !Array.isArray(garden.plants) ||
    garden.plants.length > 200
  ) return { ok: false, error: "Invalid garden schema" };

  const ids = new Set<string>();
  for (const plant of garden.plants) {
    if (!isPlant(plant) || ids.has(plant.id)) return { ok: false, error: "Invalid or duplicate plant" };
    ids.add(plant.id);
  }
  return { ok: true, value: raw as Garden };
}

export function parseGardenOperation(raw: unknown):
  | { ok: true; value: GardenOperation }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Operation must be an object" };
  const operation = raw as Record<string, unknown>;
  const expectedRevision = operation.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) return { ok: false, error: "Invalid expected revision" };
  if (operation.action === "remove") {
    if (!hasExactKeys(operation, ["action", "expectedRevision", "id"]) || !isText(operation.id, 80)) return { ok: false, error: "Invalid remove operation" };
    return { ok: true, value: { action: "remove", expectedRevision: expectedRevision as number, id: operation.id as string } };
  }
  if (operation.action !== "add" || !hasExactKeys(operation, ["action", "expectedRevision", "plant"])) return { ok: false, error: "Invalid garden operation" };
  if (!operation.plant || typeof operation.plant !== "object" || Array.isArray(operation.plant)) return { ok: false, error: "Invalid plant input" };
  const plant = operation.plant as Record<string, unknown>;
  const required = ["name", "emoji", "location", "waterSchedule", "waterDays"];
  const optional = ["img", "tip", "addedBy"];
  if (!Object.keys(plant).every((key) => [...required, ...optional].includes(key)) || !required.every((key) => key in plant)) return { ok: false, error: "Invalid plant fields" };
  if (!isText(plant.name, 120) || !isText(plant.emoji, 16) || !["indoor", "outdoor"].includes(String(plant.location)) || !isText(plant.waterSchedule, 120, false) || !validDays(plant.waterDays) || !optionalText(plant.img, 300) || !optionalText(plant.tip, 500) || !optionalText(plant.addedBy, 300)) return { ok: false, error: "Invalid plant input" };
  return { ok: true, value: { action: "add", expectedRevision: expectedRevision as number, plant: plant as AddPlantInput } };
}

export function applyGardenOperation(
  garden: Garden,
  operation: GardenOperation,
  now = new Date(),
  createId: () => string = () => crypto.randomUUID(),
): Garden {
  if (operation.expectedRevision !== garden.revision) throw new Error("Garden revision conflict");
  let plants: Plant[];
  if (operation.action === "add") {
    if (garden.plants.length >= 200) throw new Error("Garden plant limit reached");
    plants = [...garden.plants, { ...operation.plant, id: createId(), addedAt: now.toISOString() }];
  } else {
    if (!garden.plants.some((plant) => plant.id === operation.id)) throw new Error("Plant not found");
    plants = garden.plants.filter((plant) => plant.id !== operation.id);
  }
  return { version: 1, revision: garden.revision + 1, lastUpdated: now.toISOString(), plants };
}

export function isGardenMutationAuthorized(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  return Boolean((session as { user?: unknown }).user);
}

export function assertNoFakeOperationalValues(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (/67\.22|yourhandle|demo-[0-9]|Max|Sage|Knox|Nova|Pixel/.test(serialized)) throw new Error("Fabricated or fictional operational value");
  if (payload && typeof payload === "object" && "value" in payload) {
    const evidence = payload as Record<string, unknown>;
    if (!("source" in evidence) || !("updatedAt" in evidence) || !("status" in evidence)) throw new Error("Operational value lacks provenance");
  }
}
