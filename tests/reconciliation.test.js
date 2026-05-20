import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDebugTotalsReport,
  formatDebugTotalsReport,
  validateTotals,
} from "../lib/reconciliation.js";

const tabConfig = {
  fields: {
    id: "ID",
    country: "Country",
    differentMonth: "Diffrent Month",
    status: "Status",
    ftdMaker: "FTD MAKER",
    ftdDate: "FTD DATE",
    agentNames: "AGENT NAMES",
  },
};

const rows = [
  {
    ID: "A-1",
    Country: "Turkey",
    Status: "Potential",
    "Diffrent Month": "",
    "FTD MAKER": "Closer 1",
    "FTD DATE": "12/05/2026 10:00:00",
    "AGENT NAMES": "AHMET",
  },
  {
    ID: "a-1",
    Country: "Turkey",
    Status: "Potential",
    "Diffrent Month": "",
    "FTD MAKER": "Closer 2",
    "FTD DATE": "12/05/2026 12:00:00",
    "AGENT NAMES": "Ahmet",
  },
  {
    ID: "B-2",
    Country: "",
    Status: "test",
    "Diffrent Month": "yes",
    "FTD MAKER": "",
    "FTD DATE": "",
    "AGENT NAMES": "Unknown Agent",
  },
  {
    ID: "",
    Country: "",
    Status: "",
    "Diffrent Month": "",
    "FTD MAKER": "",
    "FTD DATE": "",
    "AGENT NAMES": "",
  },
];

const infoAgentRows = [{ "Agent Name": "Ahmet", "Agent Target": "15" }];

test("validateTotals detects reconciliation mismatches with normalized matching", () => {
  const result = validateTotals(rows, tabConfig, infoAgentRows);

  assert.equal(result.summary.duplicate_ids, 2);
  assert.equal(result.summary.duplicate_ftd, 2);
  assert.ok(result.summary.invalid_country_exclusions >= 1);
  assert.ok(result.summary.different_month_exclusions >= 1);
  assert.ok(result.summary.filtered_statuses >= 1);
  assert.ok(result.summary.empty_rows >= 1);
  assert.ok(result.summary.missing_targets >= 1);
  assert.ok(result.summary.normalization_mismatches >= 1);
});

test("buildDebugTotalsReport writes required CSV exports", async () => {
  const exportDir = path.join(os.tmpdir(), `reconciliation-test-${Date.now()}`);
  const report = await buildDebugTotalsReport({
    exportDir,
    context: {
      monthLabel: "May 2026",
      spreadsheetId: "sheet-id",
    },
    leadsTabConfig: tabConfig,
    infoAgentsTabConfig: {
      fields: {
        agentName: "Agent Name",
        agentTarget: "Agent Target",
      },
    },
    readRows: async (tabKey) => (tabKey === "infoAgents" ? infoAgentRows : rows),
  });

  assert.ok(report.exports.validation_leads.endsWith("validation_leads.csv"));
  assert.ok(report.exports.validation_ftd.endsWith("validation_ftd.csv"));
  assert.ok(report.exports.validation_agents.endsWith("validation_agents.csv"));

  const leadsCsv = await readFile(report.exports.validation_leads, "utf8");
  const ftdCsv = await readFile(report.exports.validation_ftd, "utf8");
  const agentsCsv = await readFile(report.exports.validation_agents, "utf8");

  assert.match(leadsCsv, /issue,row_number,id,country,status/);
  assert.match(ftdCsv, /duplicate_ftd/);
  assert.match(agentsCsv, /missing_target|agent_normalization_mismatch/);

  const text = formatDebugTotalsReport(report);
  assert.match(text, /Reconciliation Validation/);
  assert.match(text, /validation_leads\.csv/);
});
