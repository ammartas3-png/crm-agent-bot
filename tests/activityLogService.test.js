import assert from "node:assert/strict";
import test from "node:test";

import {
  appendActivityLog,
  formatTelegramDisplayName,
  logActivity,
  quickReportLabel,
  resetActivityLogStateForTests,
} from "../lib/activityLogService.js";
import { dashboardActivityFromQuery } from "../lib/dashboardActivity.js";

test("quickReportLabel maps preset keys to labels", () => {
  assert.equal(quickReportLabel("monthly"), "Monthly Quick");
  assert.equal(quickReportLabel("unknown-key"), "unknown-key");
});

test("formatTelegramDisplayName joins first and last name", () => {
  assert.equal(formatTelegramDisplayName({ first_name: "Ali", last_name: "Veli" }), "Ali Veli");
  assert.equal(formatTelegramDisplayName({ first_name: "Ali" }), "Ali");
});

test("appendActivityLog writes header when sheet is empty", async () => {
  resetActivityLogStateForTests();
  const calls = [];
  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [] } }),
        update: async (request) => {
          calls.push(["update", request]);
          return { data: {} };
        },
        append: async (request) => {
          calls.push(["append", request]);
          return { data: {} };
        },
      },
    },
  };
  await appendActivityLog(
    {
      channel: "dashboard",
      telegramUser: { id: 42, username: "demo", first_name: "Demo" },
      action: "login",
      quickReport: "",
      office: "Turkiye",
      month: "",
      metrics: "",
      details: { source: "telegram" },
    },
    {
      authorityConfig: {
        spreadsheetId: "authority-sheet",
        workedRange: "'worked'!A:K",
      },
      sheetsClient,
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "update");
  assert.deepEqual(calls[0][1].requestBody.values[0][0], "Timestamp");
  assert.equal(calls[1][0], "append");
  assert.equal(calls[1][1].requestBody.values[0][1], "dashboard");
  assert.equal(calls[1][1].requestBody.values[0][2], "42");
  assert.equal(calls[1][1].requestBody.values[0][3], "demo");
});

test("logActivity is skipped when disabled", () => {
  resetActivityLogStateForTests();
  logActivity(
    { channel: "bot", action: "start" },
    { env: { ACTIVITY_LOG_ENABLED: "0" } },
  );
});

test("dashboardActivityFromQuery detects quick report action", () => {
  const activity = dashboardActivityFromQuery({
    activityQuickPreset: "traffic",
    officeScope: "Turkiye",
    monthKey: "2026-01",
    metricFields: "leads,ftd,cr",
    reportMode: "specific",
    specificType: "builder",
  });
  assert.equal(activity.action, "quick_report");
  assert.equal(activity.activityQuickPreset, "traffic");
  assert.equal(activity.quickReport, "Traffic Reports");
  assert.equal(activity.office, "Turkiye");
  assert.equal(activity.month, "2026-01");
  assert.equal(activity.metrics, "leads,ftd,cr");
});

test("dashboardActivityFromQuery marks approved deposits page", () => {
  const activity = dashboardActivityFromQuery(
    { language: "Native", office: "Dubai" },
    { page: "Approved Deposits", action: "approved_deposits" },
  );
  assert.equal(activity.action, "approved_deposits");
  assert.equal(activity.quickReport, "Approved Deposits");
});
