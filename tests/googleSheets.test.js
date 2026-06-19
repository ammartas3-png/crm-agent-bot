import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSheetsCache,
  getGoogleCredentialConfig,
  normalizePrivateKey,
  readSheetRows,
} from "../lib/googleSheets.js";

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

test("readSheetRows bypasses the cache when a sheets client is injected", async () => {
  clearSheetsCache();
  let calls = 0;
  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async () => {
          calls += 1;
          return { data: { values: [["ID"], [String(calls)]] } };
        },
      },
    },
  };
  const options = {
    spreadsheetId: "bypass-id",
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
    sheetsClient,
  };

  const first = await readSheetRows("leads", options);
  const second = await readSheetRows("leads", options);

  assert.equal(calls, 2);
  assert.deepEqual(first, [{ ID: "1" }]);
  assert.deepEqual(second, [{ ID: "2" }]);
});

test("readSheetRows can be forced to skip the cache with cache:false", async () => {
  clearSheetsCache();
  const options = {
    spreadsheetId: "nocache-id",
    cache: false,
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
    sheetsClient: {
      spreadsheets: {
        values: {
          get: async () => ({ data: { values: [["ID"], ["7"]] } }),
        },
      },
    },
  };

  const rows = await readSheetRows("leads", options);
  assert.deepEqual(rows, [{ ID: "7" }]);
});
