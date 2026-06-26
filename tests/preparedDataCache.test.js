import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { clearOfficeMonthMapCache, getOfficeMonthMap } from "../lib/officeMappings.js";
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

test("getOfficeMonthMap prefers prepared office map over Google Sheets", async () => {
  clearPreparedDataCache();
  clearOfficeMonthMapCache();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "prepared-office-map-prefer-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  const officeMapPayload = {
    countries: ["Turkey"],
    byCountry: {},
    officesByCountry: {},
    offices: ["Turkey Office"],
    byOffice: {},
  };
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 1,
      officeMonthMap: officeMapPayload,
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
    const officeMap = await getOfficeMonthMap({ bypassCache: true });
    assert.deepEqual(officeMap, officeMapPayload);
  } finally {
    restoreEnv("N8N_PREPARED_CACHE_ENABLED", prevEnabled);
    restoreEnv("N8N_PREPARED_CACHE_DIR", prevDir);
    restoreEnv("N8N_PREPARED_CACHE_MANIFEST", prevManifest);
    clearPreparedDataCache();
    clearOfficeMonthMapCache();
    await rm(tempDir, { recursive: true, force: true });
  }
});
