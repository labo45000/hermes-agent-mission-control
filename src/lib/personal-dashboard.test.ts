import test from "node:test";
import assert from "node:assert/strict";
import {
  GARDEN_EMPTY,
  PROFILE_GROUPS,
  applyGardenOperation,
  assertNoFakeOperationalValues,
  buildProfileRoster,
  evidenceFromRows,
  evidenceFromValue,
  formatHermesRuntimeStatus,
  isGardenMutationAuthorized,
  normalizeProfileStatus,
  parseGardenOperation,
  validateGarden,
} from "./personal-dashboard";

const NOW = new Date("2026-08-26T12:00:00Z");

test("groups every Turbo profile with stable profile-name ids", () => {
  const roster = buildProfileRoster([{ name: "default" }, { name: "tradingrisk", status: "running", lastSeen: "2026-08-26T10:00:00Z" }]);
  assert.equal(roster.length, 18);
  assert.equal(roster[0].id, roster[0].profile);
  assert.equal(new Set(roster.map((profile) => profile.id)).size, 18);
  assert.deepEqual([...new Set(roster.map((profile) => profile.group))], Object.keys(PROFILE_GROUPS));
  assert.equal(roster.find((profile) => profile.id === "default")?.status, "unknown");
  assert.equal(roster.find((profile) => profile.id === "tradingrisk")?.status, "online");
});

test("normalizes only heartbeat-backed statuses as online", () => {
  assert.equal(normalizeProfileStatus("configured"), "unknown");
  assert.equal(normalizeProfileStatus("running"), "online");
  assert.equal(normalizeProfileStatus("failed"), "error");
  assert.equal(normalizeProfileStatus(undefined), "unknown");
});

test("describes Hermes runtime without conflating it with the bridge", () => {
  assert.deepEqual(formatHermesRuntimeStatus(null), { label: "Checking Hermes…", tone: "unknown" });
  assert.deepEqual(formatHermesRuntimeStatus({ online: true }), { label: "Hermes reachable", tone: "online" });
  assert.deepEqual(formatHermesRuntimeStatus({ online: false }), { label: "Hermes unavailable", tone: "offline" });
});

test("marks evidence available only inside its documented freshness window", () => {
  assert.equal(evidenceFromValue({ ok: true }, "health", new Date("2026-08-26T11:58:01Z"), 120_000, NOW).status, "available");
  assert.equal(evidenceFromValue({ ok: true }, "health", new Date("2026-08-26T11:57:59Z"), 120_000, NOW).status, "stale");
  assert.equal(evidenceFromValue(null, "missing", null, 120_000, NOW).status, "unavailable");
  assert.equal(evidenceFromValue({ ok: true }, "future", new Date("2026-08-26T12:01:00Z"), 120_000, NOW).status, "stale");
});

test("empty or missing row sources are unavailable and never stamped at read time", () => {
  assert.deepEqual(evidenceFromRows([], "HermesTask", (row: { syncedAt: Date }) => row.syncedAt, 120_000, NOW), {
    value: null,
    status: "unavailable",
    source: "HermesTask",
    updatedAt: null,
  });
  assert.deepEqual(evidenceFromRows(null, "AgentEvent", (row: { createdAt: Date }) => row.createdAt, 120_000, NOW), {
    value: null,
    status: "unavailable",
    source: "AgentEvent",
    updatedAt: null,
  });
  const rows = [{ syncedAt: new Date("2026-08-26T11:58:30Z") }, { syncedAt: new Date("2026-08-26T11:59:30Z") }];
  assert.equal(evidenceFromRows(rows, "HermesTask", (row) => row.syncedAt, 120_000, NOW).updatedAt, "2026-08-26T11:59:30.000Z");
});

test("validates the revisioned exact garden schema", () => {
  assert.deepEqual(validateGarden(GARDEN_EMPTY), { ok: true, value: GARDEN_EMPTY });
  assert.equal(validateGarden({ ...GARDEN_EMPTY, extra: true }).ok, false);
  assert.equal(validateGarden({ ...GARDEN_EMPTY, revision: -1 }).ok, false);
  assert.equal(validateGarden({ ...GARDEN_EMPTY, plants: [{ id: "p", name: "fern", emoji: "🌿", location: "inside", waterSchedule: "weekly", waterDays: [1], addedAt: NOW.toISOString() }] }).ok, false);
});

test("accepts strict semantic garden operations with an expected revision and rejects server-owned fields", () => {
  const add = parseGardenOperation({
    action: "add",
    expectedRevision: 0,
    plant: { name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "Sunday", waterDays: [0] },
  });
  assert.equal(add.ok, true);
  assert.equal(parseGardenOperation({ action: "add", expectedRevision: 0, plant: { id: "client-id", name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "", waterDays: [] } }).ok, false);
  assert.equal(parseGardenOperation({ action: "add", plant: { name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "", waterDays: [] } }).ok, false);
  assert.equal(parseGardenOperation({ action: "remove", expectedRevision: 0, id: "p", lastUpdated: NOW.toISOString() }).ok, false);
  assert.equal(parseGardenOperation({ action: "remove", expectedRevision: -1, id: "p" }).ok, false);
  assert.equal(parseGardenOperation({ action: "remove", expectedRevision: 0, id: "" }).ok, false);
});

test("server rejects a stale garden revision without applying the operation", () => {
  const add = parseGardenOperation({ action: "add", expectedRevision: 2, plant: { name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "Sunday", waterDays: [0] } });
  assert.equal(add.ok, true);
  if (!add.ok) return;
  assert.throws(() => applyGardenOperation(GARDEN_EMPTY, add.value, NOW, () => "server-id"), /revision conflict/i);
  assert.deepEqual(GARDEN_EMPTY, { version: 1, revision: 0, lastUpdated: "", plants: [] });
});

test("server applies operations and owns revision, id, and timestamps", () => {
  const add = parseGardenOperation({ action: "add", expectedRevision: 0, plant: { name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "Sunday", waterDays: [0] } });
  assert.equal(add.ok, true);
  if (!add.ok) return;
  const added = applyGardenOperation(GARDEN_EMPTY, add.value, NOW, () => "server-id");
  assert.equal(added.revision, 1);
  assert.equal(added.lastUpdated, NOW.toISOString());
  assert.equal(added.plants[0].id, "server-id");
  assert.equal(added.plants[0].addedAt, NOW.toISOString());

  const remove = parseGardenOperation({ action: "remove", expectedRevision: 1, id: "server-id" });
  assert.equal(remove.ok, true);
  if (!remove.ok) return;
  const removed = applyGardenOperation(added, remove.value, new Date("2026-08-26T12:01:00Z"), () => "unused");
  assert.equal(removed.revision, 2);
  assert.equal(removed.plants.length, 0);
  const staleRemove = { ...remove.value, expectedRevision: 2 };
  assert.throws(() => applyGardenOperation(removed, staleRemove, NOW, () => "unused"), /not found/);
});

test("garden mutations require a session in every environment", () => {
  assert.equal(isGardenMutationAuthorized(null), false);
  assert.equal(isGardenMutationAuthorized(undefined), false);
  assert.equal(isGardenMutationAuthorized({ user: { email: "turbo@example.com" } }), true);
});

test("operational payload guard rejects fabricated values and requires provenance", () => {
  assert.doesNotThrow(() => assertNoFakeOperationalValues({ status: "unavailable", source: "not-configured", updatedAt: null, value: null }));
  assert.throws(() => assertNoFakeOperationalValues({ pnl: 67.22 }));
  assert.throws(() => assertNoFakeOperationalValues({ value: 12, status: "available" }));
});
