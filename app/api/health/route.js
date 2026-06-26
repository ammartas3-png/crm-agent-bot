import { NextResponse } from "next/server";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { getDashboardDataProvider } from "../../../lib/dashboardDataProvider.js";
import { readPreparedManifest } from "../../../lib/preparedDataCache.js";

function asBool(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function requiredEnvStatus() {
  return {
    googleServiceAccountEmailConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    googlePrivateKeyConfigured: Boolean(
      process.env.GOOGLE_PRIVATE_KEY ||
        process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
        process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        process.env.GOOGLE_CREDENTIALS_JSON,
    ),
    googleSpreadsheetIdConfigured: Boolean(process.env.GOOGLE_SPREADSHEET_ID),
    n8nSecretConfigured: Boolean(process.env.N8N_WORKFLOW_SECRET),
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const fullCheck = asBool(url.searchParams.get("full"));
  const provider = getDashboardDataProvider();
  const manifest = await readPreparedManifest();
  const checks = {
    provider: {
      name: provider.name,
    },
    preparedCache: {
      enabled: asBool(process.env.N8N_PREPARED_CACHE_ENABLED),
      required: asBool(process.env.N8N_PREPARED_CACHE_REQUIRED),
      manifestLoaded: Boolean(manifest),
      manifestVersion: Number(manifest?.version || 0) || null,
    },
    env: requiredEnvStatus(),
  };
  if (fullCheck) {
    try {
      const leadsRows = await provider.readSheetRows("leads", {
        tabConfig: getTabConfig("leads"),
      });
      checks.dataRead = {
        ok: true,
        rowCount: Array.isArray(leadsRows) ? leadsRows.length : 0,
      };
    } catch (error) {
      checks.dataRead = {
        ok: false,
        message: error?.message || "Could not read provider data.",
      };
    }
  }
  const ok = fullCheck ? Boolean(checks?.dataRead?.ok) : true;
  return NextResponse.json({
    ok,
    service: "crm-dashboard",
    time: new Date().toISOString(),
    checks,
  });
}
