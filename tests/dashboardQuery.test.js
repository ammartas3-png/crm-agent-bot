import assert from "node:assert/strict";
import test from "node:test";

import {
  isEnabledFlag,
  knownDashboardQueryKeys,
  normalizeDashboardQueryPayload,
  parseDashboardQueryFromSearchParams,
} from "../lib/dashboardQuery.js";

test("parseDashboardQueryFromSearchParams normalizes known keys only", () => {
  const params = new URLSearchParams();
  params.set("monthKey", " 2026-06 ");
  params.set("officeScope", "turkiye");
  params.set("unknown", "x");
  const parsed = parseDashboardQueryFromSearchParams(params);
  assert.equal(parsed.monthKey, "2026-06");
  assert.equal(parsed.officeScope, "turkiye");
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "unknown"), false);
});

test("normalizeDashboardQueryPayload handles arrays and booleans", () => {
  const query = normalizeDashboardQueryPayload({
    monthKey: ["2026-06", "2026-05"],
    includeWorkTime: true,
  });
  assert.equal(query.monthKey, "2026-06,2026-05");
  assert.equal(query.includeWorkTime, "1");
});

test("isEnabledFlag supports common enabled values", () => {
  assert.equal(isEnabledFlag("yes"), true);
  assert.equal(isEnabledFlag("true"), true);
  assert.equal(isEnabledFlag("0"), false);
  assert.equal(isEnabledFlag("", true), true);
  assert.ok(knownDashboardQueryKeys().includes("reportMode"));
});
