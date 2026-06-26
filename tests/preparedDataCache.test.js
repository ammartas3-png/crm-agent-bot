import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDashboardDataProvider } from "../lib/dashboardDataProvider.js";
import { clearPreparedDataCache, readPreparedOfficeMonthMap } from "../lib/preparedDataCache.js";

function restoreEnv(key, previousValue) {
  if (previousValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previousValue;
  }
}

test("readPreparedOfficeMonthMap reads object from manifest file reference", async () => {
  clearPreparedDataCache();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "prepared-office-map-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const officeMapPath = path.join(tempDir, "office-month-map.json");
  const officeMapPayload = {
    countries: ["Turkey"],
    byCountry: {},
    officesByCountry: {},
    offices: ["Turkey Office"],
    byOffice: {
      "Turkey Office": [
        {
          key: "2026-06",
          month_label: "June 2026",
          sheet_id: "sheet-1",
          office_name: "Turkey Office",
          country: "Turkey",
          active: true,
        },
      ],
    },
  };
  await mkdir(path.dirname(officeMapPath), { recursive: true });
  await writeFile(officeMapPath, JSON.stringify(officeMapPayload), "utf8");
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      officeMonthMap: "office-month-map.json",
    }),
    "utf8",
  );
  const prevEnabled = process.env.N8N_PREPARED_CACHE_ENABLED;
  const prevDir = process.env.N8N_PREPARED_CACHE_DIR;
  const prevManifest = process.env.N8N_PREPARED_CACHE_MANIFEST;
  process.env.N8N_PREPARED_CACHE_ENABLED = "1";
  process.env.N8N_PREPARED_CACHE_DIR = tempDir;
  process.env.N8N_PREPARED_CACHE_MANIFEST = manifestPath;
  try {
    const officeMap = await readPreparedOfficeMonthMap();
    assert.deepEqual(officeMap, officeMapPayload);
  } finally {
    restoreEnv("N8N_PREPARED_CACHE_ENABLED", prevEnabled);
    restoreEnv("N8N_PREPARED_CACHE_DIR", prevDir);
    restoreEnv("N8N_PREPARED_CACHE_MANIFEST", prevManifest);
    clearPreparedDataCache();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dashboard data provider n8nCache reads prepared rows first", async () => {
  let googleCalls = 0;
  const provider = createDashboardDataProvider(
    { provider: "n8nCache" },
    {
      readPreparedSheetRows: async () => [{ ID: "prepared-1" }],
      readGoogleSheetRows: async () => {
        googleCalls += 1;
        return [{ ID: "google-1" }];
      },
      readPreparedOfficeMonthMap: async () => ({
        countries: ["Turkey"],
        byCountry: {},
        officesByCountry: {},
        offices: ["Turkey Office"],
        byOffice: {},
      }),
      readGoogleOfficeMonthMap: async () => ({ countries: [], byCountry: {}, officesByCountry: {}, offices: [], byOffice: {} }),
      preparedDataCacheRequired: () => false,
    },
  );
  const rows = await provider.readSheetRows("leads", {
    spreadsheetId: "spreadsheet-id",
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
  });
  assert.deepEqual(rows, [{ ID: "prepared-1" }]);
  assert.equal(googleCalls, 0);
});

test("dashboard data provider n8nCache falls back to Google Sheets when cache misses", async () => {
  let googleCalls = 0;
  const provider = createDashboardDataProvider(
    { provider: "n8nCache" },
    {
      readPreparedSheetRows: async () => null,
      readGoogleSheetRows: async () => {
        googleCalls += 1;
        return [{ ID: "google-1" }];
      },
      readPreparedOfficeMonthMap: async () => null,
      readGoogleOfficeMonthMap: async () => ({
        countries: ["Turkey"],
        byCountry: {},
        officesByCountry: {},
        offices: ["Turkey Office"],
        byOffice: {},
      }),
      preparedDataCacheRequired: () => false,
    },
  );
  const rows = await provider.readSheetRows("leads", {
    spreadsheetId: "spreadsheet-id",
    tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
  });
  assert.deepEqual(rows, [{ ID: "google-1" }]);
  assert.equal(googleCalls, 1);
  const officeMap = await provider.getOfficeMonthMap({ bypassCache: true });
  assert.equal(officeMap.offices.length, 1);
});

test("dashboard data provider n8nCache blocks fallback when cache required", async () => {
  const provider = createDashboardDataProvider(
    { provider: "n8nCache" },
    {
      readPreparedSheetRows: async () => null,
      readGoogleSheetRows: async () => [{ ID: "google-1" }],
      readPreparedOfficeMonthMap: async () => null,
      readGoogleOfficeMonthMap: async () => ({
        countries: [],
        byCountry: {},
        officesByCountry: {},
        offices: [],
        byOffice: {},
      }),
      preparedDataCacheRequired: () => true,
    },
  );
  await assert.rejects(
    () =>
      provider.readSheetRows("leads", {
        spreadsheetId: "spreadsheet-id",
        tabConfig: { name: "Leads", range: "'Leads'!A:Y", columns: ["ID"] },
      }),
    /Prepared cache miss/,
  );
  await assert.rejects(() => provider.getOfficeMonthMap({}), /Prepared office month map cache is required/);
});
