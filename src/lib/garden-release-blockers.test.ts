import test from "node:test";
import assert from "node:assert/strict";
import { executeGardenMutation } from "./garden-client";
import { GARDEN_EMPTY, type Garden, type GardenOperation } from "./personal-dashboard";
import { handleGardenMutation, type GardenTransactionRepository } from "./garden-route-service";

const addOperation = (expectedRevision = 0): GardenOperation => ({
  action: "add",
  expectedRevision,
  plant: { name: "Fern", emoji: "🌿", location: "indoor", waterSchedule: "Sunday", waterDays: [0] },
});

test("rejected garden fetch always clears saving and exposes retry guidance", async () => {
  const saving: boolean[] = [];
  const errors: Array<string | null> = [];
  await executeGardenMutation({
    request: async () => { throw new Error("network down"); },
    setSaving: (value) => saving.push(value),
    setError: (value) => errors.push(value),
    onSaved: () => assert.fail("must not save"),
    onConflict: () => assert.fail("must not conflict"),
    retryMessage: "Plant was not saved. Keep this form open and retry.",
  });
  assert.deepEqual(saving, [true, false]);
  assert.equal(errors.at(-1), "Plant was not saved. Keep this form open and retry.");
});

class SerializedFakeRepository implements GardenTransactionRepository {
  garden: Garden = GARDEN_EMPTY;
  writes = 0;
  private queue = Promise.resolve();

  runSerialized<T>(work: (garden: Garden) => Promise<{ result: T; nextGarden?: Garden }>): Promise<T> {
    const run = this.queue.then(async () => {
      const { result, nextGarden } = await work(this.garden);
      if (nextGarden) { this.garden = nextGarden; this.writes += 1; }
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

test("route service maps a stale expectedRevision to 409 without mutation", async () => {
  const repository = new SerializedFakeRepository();
  repository.garden = { ...GARDEN_EMPTY, revision: 1 };
  const response = await handleGardenMutation(addOperation(0), repository, {
    now: () => new Date("2026-08-27T10:00:00Z"), createId: () => "plant-1",
  });
  assert.equal(response.status, 409);
  assert.equal(repository.writes, 0);
  assert.equal(repository.garden.revision, 1);
  assert.deepEqual(response.body, { error: "Garden revision conflict", garden: repository.garden });
});

test("serialized same-revision operations produce exactly one success and one conflict", async () => {
  const repository = new SerializedFakeRepository();
  const [first, second] = await Promise.all([
    handleGardenMutation(addOperation(0), repository, { now: () => new Date("2026-08-27T10:00:00Z"), createId: () => "plant-1" }),
    handleGardenMutation(addOperation(0), repository, { now: () => new Date("2026-08-27T10:00:01Z"), createId: () => "plant-2" }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(repository.writes, 1);
  assert.equal(repository.garden.revision, 1);
  assert.equal(repository.garden.plants.length, 1);
});
