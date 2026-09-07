import assert from "node:assert/strict";
import test from "node:test";

import { reportCacheKey } from "../lib/dashboardService.js";

const access = { authorityScope: { unrestricted: true, admin: true }, permissionFilters: {} };

test("live view and export share a cache key when data params match", () => {
  // What the on-screen (SSE) dashboard sends.
  const liveQuery = {
    officeScope: "Turkiye Office",
    monthKey: "2026-08",
    reportMode: "specific",
    leadSplitter: "1",
    date: "2026-08-18",
    rowDimensions: "agent",
    metricFields: "leads,ftd",
    monitor: "1",
    page: "",
    rowLimit: "",
  };
  // What the export sends for the same view (extra delivery-only params).
  const exportQuery = {
    officeScope: "Turkiye Office",
    monthKey: "2026-08",
    reportMode: "specific",
    leadSplitter: "1",
    date: "2026-08-18",
    rowDimensions: "agent",
    metricFields: "leads,ftd",
    reportName: "LeadSplitter",
    sourceUrl: "https://crm-agent-bot-hj5k.vercel.app/dashboard",
    tpCountries: "",
  };
  assert.equal(
    reportCacheKey(access, liveQuery),
    reportCacheKey(access, exportQuery),
    "export must reuse the live view's cached report",
  );
});

test("different data params still produce different cache keys", () => {
  const base = { officeScope: "Turkiye Office", monthKey: "2026-08", date: "2026-08-18" };
  const other = { ...base, date: "2026-08-17" };
  assert.notEqual(reportCacheKey(access, base), reportCacheKey(access, other));
});
