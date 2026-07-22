import assert from "node:assert/strict";
import test from "node:test";

import { auditReportResult, summarizeAuditResults } from "../lib/quickReportAudit.js";
import { buildQuickReportQuery, QUICK_REPORT_PRESET_KEYS } from "../lib/quickReportPresets.js";

test("buildQuickReportQuery mirrors monthly quick preset", () => {
  const query = buildQuickReportQuery({
    office: "Pakistan Office",
    monthKeys: ["2026-06", "2026-05"],
    preset: "monthly",
  });
  assert.equal(query.officeScope, "Pakistan Office");
  assert.equal(query.monthKey, "2026-06");
  assert.match(query.metricFields, /kycFtd/);
  assert.equal(query.hideNotWorking, "1");
});

test("all quick presets build a query", () => {
  for (const preset of QUICK_REPORT_PRESET_KEYS) {
    const query = buildQuickReportQuery({
      office: "Turkiye Office",
      monthKeys: ["2026-06", "2026-05", "2026-04", "2026-03"],
      preset,
    });
    assert.equal(query.officeScope, "Turkiye Office");
    assert.ok(query.metricFields);
    assert.ok(query.rowDimensions);
  }
});

test("auditReportResult flags CR mismatch in summary", () => {
  const issues = auditReportResult(
    {
      tableType: "builder",
      summary: {
        totalLeads: 100,
        totalFtd: 10,
        cr: 5,
        crTarget: 10,
        crTargetReach: 50,
        ftdTarget: 20,
        ftdTargetReach: 50,
      },
      table: [{ desk: "Desk A", teamLeader: "-", agent: "Agent 1", leads: 100, ftd: 10 }],
      builder: { selectedDimensions: [{ key: "desk" }, { key: "teamLeader" }, { key: "agent" }] },
    },
    { office: "Pakistan Office", preset: "monthly" },
  );
  assert.ok(issues.some((issue) => issue.code === "summary_cr_mismatch"));
});

test("auditReportResult flags builder leaf sum mismatch", () => {
  const issues = auditReportResult(
    {
      tableType: "builder",
      summary: { totalLeads: 100, totalFtd: 10, cr: 10, crTarget: 0, crTargetReach: 0, ftdTarget: 0, ftdTargetReach: 0 },
      table: [
        { desk: "Desk A", teamLeader: "TL", agent: "Agent 1", leads: 60, ftd: 6 },
        { desk: "Desk A", teamLeader: "TL", agent: "Agent 2", leads: 30, ftd: 3 },
      ],
      builder: { selectedDimensions: [{ key: "desk" }, { key: "teamLeader" }, { key: "agent" }] },
    },
    { office: "Pakistan Office", preset: "monthly" },
  );
  assert.ok(issues.some((issue) => issue.code === "builder_leaf_sum_mismatch"));
});

test("summarizeAuditResults aggregates issue counts", () => {
  const summary = summarizeAuditResults([
    {
      office: "Pakistan Office",
      preset: "monthly",
      monthKey: "2026-06",
      issues: [{ code: "summary_cr_mismatch", severity: "error" }],
      elapsedMs: 10,
    },
    {
      office: "Dubai Office",
      preset: "traffic",
      monthKey: "2026-06",
      issues: [{ code: "lead_share_not_100", severity: "warn" }],
      elapsedMs: 20,
    },
  ]);
  assert.equal(summary.runCount, 2);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.ok, false);
});
