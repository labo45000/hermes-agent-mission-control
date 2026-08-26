import test from "node:test";
import assert from "node:assert/strict";
import { assertMemoryEntry, isWithin, parseEntry } from "../bridge.mjs";

const valid = {
  id: "pricing-decision", path: "decisions/pricing-decision.md", type: "decision",
  title: "Pricing decision", body: "Data, not instructions.", status: "active",
  confidence: "high", trust: "reviewed", tags: [], links: [],
};

test("accepts a canonical memory entry", () => assert.doesNotThrow(() => assertMemoryEntry(valid)));

test("rejects traversal and non-canonical paths", () => {
  assert.throws(() => assertMemoryEntry({ ...valid, path: "../../.ssh/authorized_keys" }), /path/);
  assert.throws(() => assertMemoryEntry({ ...valid, path: "/tmp/pwned" }), /path/);
  assert.throws(() => assertMemoryEntry({ ...valid, path: "facts/other.md" }), /canonical/);
});

test("rejects invalid enums and inverted validity windows", () => {
  assert.throws(() => assertMemoryEntry({ ...valid, trust: "root" }), /trust/);
  assert.throws(() => assertMemoryEntry({ ...valid, validFrom: "2026-08-26", validTo: "2026-08-25" }), /precede/);
});

test("path boundary check rejects siblings and accepts descendants", () => {
  assert.equal(isWithin("/home/hermes/wiki", "/home/hermes/wiki/facts/a.md"), true);
  assert.equal(isWithin("/home/hermes/wiki", "/home/hermes/wiki-evil/a.md"), false);
  assert.equal(isWithin("/home/hermes/wiki", "/home/hermes/.ssh/id_ed25519"), false);
});

test("safe YAML parser preserves quoted values and rejects duplicate keys", () => {
  const parsed = parseEntry('---\ntitle: "A: quoted title"\ntags: ["one, two", safe]\n---\nbody');
  assert.equal(parsed.fm.title, "A: quoted title");
  assert.deepEqual(parsed.fm.tags, ["one, two", "safe"]);
  assert.throws(() => parseEntry("---\ntitle: one\ntitle: two\n---\nbody"));
});
