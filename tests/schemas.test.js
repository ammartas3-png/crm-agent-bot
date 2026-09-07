import test from "node:test";
import assert from "node:assert/strict";

import { ingestBodySchema, aiAskSchema, formatZodError } from "../lib/schemas.js";

test("ingest schema accepts rows[] payloads", () => {
  const result = ingestBodySchema.safeParse({
    sourceKey: "turkey-2026-08-leads",
    rows: [{ ID: "1", Agent: "Ali" }],
    office: "Turkey",
  });
  assert.equal(result.success, true);
});

test("ingest schema accepts values[][] payloads", () => {
  const result = ingestBodySchema.safeParse({
    sourceKey: "turkey-2026-08-leads",
    values: [["ID", "Agent"], ["1", "Ali"]],
  });
  assert.equal(result.success, true);
});

test("ingest schema rejects a missing sourceKey with a clear message", () => {
  const result = ingestBodySchema.safeParse({ rows: [] });
  assert.equal(result.success, false);
  assert.match(formatZodError(result.error), /sourceKey is required/);
});

test("ingest schema rejects payloads without rows or values", () => {
  const result = ingestBodySchema.safeParse({ sourceKey: "x" });
  assert.equal(result.success, false);
  assert.match(formatZodError(result.error), /rows\[\]/);
});

test("ingest schema keeps unknown envelope fields (passthrough)", () => {
  const result = ingestBodySchema.safeParse({
    sourceKey: "x",
    rows: [],
    extra: "keep-me",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.extra, "keep-me");
});

test("ai ask schema requires a non-empty question", () => {
  assert.equal(aiAskSchema.safeParse({ question: "How is Ali?" }).success, true);
  const blank = aiAskSchema.safeParse({ question: "   " });
  assert.equal(blank.success, false);
  assert.match(formatZodError(blank.error), /Missing 'question'/);
});

test("formatZodError falls back to a generic message", () => {
  assert.equal(formatZodError(null), "Invalid request.");
  assert.equal(formatZodError({ issues: [] }), "Invalid request.");
});
