import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSheetCache,
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
  clearSheetCache();
  let requestedRange = "";
  const rows = await readSheetRows("leads", {
    spreadsheetId: "spreadsheet-id",
    cache: false,
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

test("readSheetRows caches reads per spreadsheet/range within the TTL", async () => {
  clearSheetCache();
  let getCalls = 0;
  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async () => {
          getCalls += 1;
          return { data: { values: [["1"], ["2"]] } };
        },
      },
    },
  };
  const options = {
    spreadsheetId: "cache-test-id",
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
    sheetsClient,
  };

  const first = await readSheetRows("leads", options);
  const second = await readSheetRows("leads", options);

  assert.equal(getCalls, 1, "second read should be served from cache");
  assert.deepEqual(first, second);

  const fresh = await readSheetRows("leads", { ...options, cache: false });
  assert.equal(getCalls, 2, "cache: false should force a fresh read");
  assert.deepEqual(fresh, first);

  clearSheetCache();
});
