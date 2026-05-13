import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL,
  DEFAULT_GOOGLE_SPREADSHEET_ID,
  DEFAULT_LEADS_TAB,
  quoteSheetName,
  sheetRange,
  sheetsConfig,
} from "../config/sheetsConfig.js";

test("sheetsConfig uses the provided Google Sheet by default", () => {
  assert.equal(sheetsConfig.spreadsheetId, DEFAULT_GOOGLE_SPREADSHEET_ID);
  assert.equal(sheetsConfig.serviceAccountEmail, DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL);
  assert.equal(DEFAULT_LEADS_TAB, "Leads");
  assert.equal(sheetsConfig.tabs.leads.name, "Leads");
  assert.equal(sheetsConfig.tabs.leads.range, "'Leads'!A:W");
});

test("sheetRange trims and quotes tab names", () => {
  assert.equal(sheetRange("  Leads  ", " A:W "), "'Leads'!A:W");
});

test("quoteSheetName escapes apostrophes for Google A1 notation", () => {
  assert.equal(quoteSheetName("May's Leads"), "'May''s Leads'");
});
