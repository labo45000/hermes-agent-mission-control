import test from "node:test";
import assert from "node:assert/strict";
import { canonicalMemoryId, memoryRelevance, parseMemoryInput } from "./memory";

test("derives the path server-side and ignores hostile client paths", () => {
  const memory = parseMemoryInput({ title: "My Decision", type: "decision", path: "../../.ssh/authorized_keys" });
  assert.equal(memory.path, "decisions/my-decision.md");
});

test("validates enums, sizes and canonical ids", () => {
  assert.equal(parseMemoryInput({ title: "Fact", confidence: "high", trust: "authoritative" }).confidence, "high");
  assert.equal(parseMemoryInput({ title: "Fact", confidence: 0.9 }).confidence, "medium");
  assert.throws(() => parseMemoryInput({ title: "x", body: "a".repeat(100_001) }), /body/);
  assert.throws(() => parseMemoryInput({ title: "x", validFrom: "2026-08-26", validTo: "2026-08-25" }), /precede/);
  assert.equal(canonicalMemoryId("../bad", "Résumé client"), "resume-client");
});

test("ranking favors titles and authoritative sources and suppresses quarantine", () => {
  const base = { body: "pricing context", tags: ["billing"], status: "active", trust: "reviewed", updatedAt: new Date() };
  const title = memoryRelevance({ ...base, title: "Pricing decision" }, "pricing");
  const body = memoryRelevance({ ...base, title: "Other" }, "pricing");
  const quarantined = memoryRelevance({ ...base, title: "Pricing", status: "quarantined" }, "pricing");
  assert.ok(title > body);
  assert.ok(quarantined < 0);
});
