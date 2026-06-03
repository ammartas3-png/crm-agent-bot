import assert from "node:assert/strict";
import test from "node:test";

import { getGoogleCredentialConfig, normalizePrivateKey, readSheetRows } from "../lib/googleSheets.js";

const RAW_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
const NORMALIZED_KEY = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";

test("normalizePrivateKey converts escaped newlines", () => {
  assert.equal(normalizePrivateKey(RAW_KEY), NORMALIZED_KEY);
});

test("getGoogleCredentialConfig reads GOOGLE_PRIVATE_KEY", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GOOGLE_PRIVATE_KEY: RAW_KEY,
  });

  assert.equal(config.email, "svc@example.com");
  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_PRIVATE_KEY");
});

test("getGoogleCredentialConfig reads base64 private key", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GOOGLE_PRIVATE_KEY_BASE64: Buffer.from(RAW_KEY, "utf8").toString("base64"),
  });

  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_PRIVATE_KEY_BASE64");
});

test("getGoogleCredentialConfig reads service account JSON", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "json@example.com",
      private_key: RAW_KEY,
    }),
  });

  assert.equal(config.email, "json@example.com");
  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_SERVICE_ACCOUNT_JSON");
});

test("readSheetRows builds a trimmed quoted range from tab name when range is absent", async () => {
  let requestedRange = "";
  const rows = await readSheetRows("leads", {
    spreadsheetId: "spreadsheet-id",
    tabConfig: {
      name: "  Leads  ",
      columns: ["ID"],
    },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async ({ range }) => {
            requestedRange = range;
            return { data: { values: [["1"]] } };
          },
        },
      },
    },
  });

  assert.equal(requestedRange, "'Leads'!A:Y");
  assert.deepEqual(rows, [{ ID: "1" }]);
});

test("readSheetRows falls back to configured column when header cell is blank", async () => {
  const rows = await readSheetRows("infoAgents", {
    spreadsheetId: "spreadsheet-id",
    tabConfig: {
      name: "Info Agents",
      range: "'Info Agents'!A:L",
      columns: [
        "Working Status",
        "LANG",
        "Agent",
        "TARGET'S",
        "FTD'S",
        "Office",
        "Team Leader",
        "Leads",
        "CR",
        "CR TARGET",
        "Late FTD",
        "Starting Date",
      ],
    },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => ({
            data: {
              values: [
                [
                  "Working Status",
                  "LANG",
                  "Agent",
                  "TARGET'S",
                  "FTD'S",
                  "Office",
                  "Team Leader",
                  "Leads",
                  "CR",
                  "CR TARGET",
                  "Late FTD",
                  "",
                ],
                ["Working", "ENG", "Ahmet", "10", "2", "Turkey English", "Leader 1", "30", "5%", "5%", "0", "13/02/2022"],
              ],
            },
          }),
        },
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Agent"], "Ahmet");
  assert.equal(rows[0]["Starting Date"], "13/02/2022");
});

test("readSheetRows aligns headerless Leads rows when Department column is missing", async () => {
  const rows = await readSheetRows("leads", {
    spreadsheetId: "spreadsheet-id",
    tabConfig: {
      name: "January 26 Pakistan Leads",
      range: "'January 26 Pakistan Leads'!A:Y",
      columns: [
        "Brand",
        "ID",
        "Created",
        "Department",
        "Status",
        "Country",
        "Campaign",
        "Sub-Campaign",
        "Placement",
        "First Call Agent",
        "Team Leader",
        "FTD",
        null,
        "FTD MAKER",
        "Desk",
        "CR TARGET",
        "FTD DATE",
        "Selfs",
        "LATE FTD Difrrence",
        "LATE FTD +30 Day",
        "Diffrent Month",
        "AGENT NAMES",
        "Agent ID",
        null,
        "Lead Date",
      ],
    },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => ({
            data: {
              values: [
                [
                  "Brand A",
                  "1001",
                  "2026-01-14",
                  "No Answer",
                  "Pakistan",
                  "Camp 1",
                  "Sub 1",
                  "Placement 1",
                  "Agent One",
                  "Team One",
                  "1",
                  "",
                  "Maker One",
                  "Pakistan Urdu Desk",
                  "6%",
                  "2026-01-20",
                  "0",
                  "0",
                  "0",
                  "",
                  "Agent One",
                  "A-1001",
                  "",
                  "2026-01-14",
                ],
              ],
            },
          }),
        },
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Status"], "No Answer");
  assert.equal(rows[0]["Country"], "Pakistan");
  assert.equal(rows[0]["FTD"], "1");
  assert.equal(rows[0]["FTD MAKER"], "Maker One");
  assert.equal(rows[0]["Desk"], "Pakistan Urdu Desk");
  assert.equal(rows[0]["Lead Date"], "2026-01-14");
});
