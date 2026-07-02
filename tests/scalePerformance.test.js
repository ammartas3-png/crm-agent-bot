import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardReportCacheKey,
  shouldUseDashboardReportCache,
} from "../lib/dashboardReportCache.js";
import { checkRateLimit, rateLimitKeyFromDashboardUser } from "../lib/rateLimit.js";

test("dashboard report cache key is stable for identical queries", () => {
  const access = { authorityScope: { unrestricted: true }, permissionFilters: {} };
  const left = dashboardReportCacheKey(access, { monthKey: "2026-03", officeScope: "Pakistan" });
  const right = dashboardReportCacheKey(access, { officeScope: "Pakistan", monthKey: "2026-03" });
  assert.equal(left, right);
});

test("dashboard report cache skips monitor and debug queries", () => {
  assert.equal(shouldUseDashboardReportCache({ monthKey: "2026-03" }), true);
  assert.equal(shouldUseDashboardReportCache({ monitor: "1" }), false);
  assert.equal(shouldUseDashboardReportCache({ debugDiagnostics: "true" }), false);
});

test("rate limit blocks after max requests in a window", async () => {
  const key = `test-${Date.now()}`;
  const options = { prefix: "TEST_RATE_LIMIT", max: 2, windowMs: 60_000 };
  const first = await checkRateLimit(key, options);
  const second = await checkRateLimit(key, options);
  const third = await checkRateLimit(key, options);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
});

test("dashboard rate limit key includes permission scope", () => {
  const key = rateLimitKeyFromDashboardUser({ id: 42 }, {
    authorityScope: { unrestricted: false },
    permissionFilters: { office: ["Pakistan"] },
  });
  assert.match(key, /^dash:42:/);
});
