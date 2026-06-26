import assert from "node:assert/strict";
import test from "node:test";

import {
  clearDashboardReportCache,
  dashboardBootstrap,
  loadDashboardReport,
  refreshOfficeDeskLanguageBenchmarks,
} from "../lib/dashboardService.js";

function createAccessContext() {
  return {
    authorized: true,
    permissionFilters: {},
    authorityScope: {
      allowed: true,
      unrestricted: true,
      filters: {},
    },
    telegramUser: {
      id: 101,
      username: "tester",
    },
  };
}

function createOfficeMap() {
  return {
    offices: ["turkiye"],
    byOffice: {
      turkiye: [
        {
          key: "2026-05",
          month_label: "May 2026",
          office_name: "turkiye",
          sheet_id: "sheet-2026-05",
          active: true,
        },
      ],
    },
  };
}

function createProvider(overrides = {}) {
  const officeMap = createOfficeMap();
  return {
    name: "testProvider",
    async getOfficeMonthMap() {
      return officeMap;
    },
    async readSheetRows(sheetKey, options = {}) {
      if (sheetKey === "leads" && options.spreadsheetId === "sheet-2026-05") {
        return [
          {
            Brand: "BrandA",
            ID: "1",
            Created: "2026-05-03",
            Department: "Sales",
            Status: "New",
            Country: "TR",
            Campaign: "CampA",
            "Sub-Campaign": "SubA",
            Placement: "P1",
            "Team Leader": "TL 1",
            FTD: "1",
            Desk: "Desk Alpha",
            "CR TARGET": "20",
            "Lead Date": "2026-05-03",
            "AGENT NAMES": "Agent One",
          },
          {
            Brand: "BrandA",
            ID: "2",
            Created: "2026-05-04",
            Department: "Sales",
            Status: "New",
            Country: "TR",
            Campaign: "CampA",
            "Sub-Campaign": "SubA",
            Placement: "P1",
            "Team Leader": "TL 1",
            FTD: "0",
            Desk: "Desk Alpha",
            "CR TARGET": "20",
            "Lead Date": "2026-05-04",
            "AGENT NAMES": "Agent One",
          },
        ];
      }
      if (sheetKey === "officeDeskLanguage") {
        return [{ Desk: "Desk Alpha", Lang: "TR" }];
      }
      if (sheetKey === "officeAgentRoster") {
        const tabName = String(options?.tabConfig?.name || "");
        if (tabName === "Turkiye") {
          return [
            {
              Agent: "Agent One",
              "Working Status": "Working",
              Desk: "Desk Alpha",
              "Team Leader": "TL 1",
              "Starting Date": "2026-03-01",
              "Old Name": "",
            },
          ];
        }
      }
      return [];
    },
    ...overrides,
  };
}

test("dashboardBootstrap resolves month list and office scopes", async () => {
  clearDashboardReportCache();
  const accessContext = createAccessContext();
  const provider = createProvider();
  const bootstrap = await dashboardBootstrap(accessContext, {
    dataProvider: provider,
    now: new Date("2026-05-15T00:00:00.000Z"),
  });
  assert.equal(Array.isArray(bootstrap.months), true);
  assert.ok(bootstrap.months.some((month) => month?.key === "2026-05"));
  assert.ok(Boolean(bootstrap.defaultMonthKey));
  assert.deepEqual(bootstrap.officeScopes, ["turkiye"]);
});

test("loadDashboardReport specific builder keeps API contract", async () => {
  clearDashboardReportCache();
  const accessContext = createAccessContext();
  const provider = createProvider();
  const report = await loadDashboardReport(
    accessContext,
    {
      monthKey: "2026-05",
      officeScope: "turkiye",
      reportMode: "specific",
      specificType: "builder",
      rowDimensions: "desk,agent",
      metricFields: "leads,ftd,cr",
      page: "1",
      rowLimit: "50",
    },
    {
      dataProvider: provider,
      now: new Date("2026-05-15T00:00:00.000Z"),
      skipResultCache: true,
    },
  );
  assert.equal(report.reportMode, "specific");
  assert.equal(report.specificType, "builder");
  assert.equal(report.summary.totalLeads, 2);
  assert.equal(report.summary.totalFtd, 1);
  assert.equal(Array.isArray(report.table), true);
  assert.ok(report.table.length >= 1);
});

test("refreshOfficeDeskLanguageBenchmarks updates language sheet rows", async () => {
  clearDashboardReportCache();
  const provider = createProvider();
  const writes = [];
  const result = await refreshOfficeDeskLanguageBenchmarks({
    dataProvider: provider,
    now: new Date("2026-06-15T00:00:00.000Z"),
    updateSheetValues: async (payload) => {
      writes.push(payload);
      return { ok: true };
    },
  });
  assert.equal(result.officeCount, 1);
  assert.equal(result.updatedRows, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.range, "'Language'!A:D");
  assert.equal(Array.isArray(writes[0]?.values), true);
  assert.equal(writes[0].values.length, 2);
});
