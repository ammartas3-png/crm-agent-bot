import { NextResponse } from "next/server";

import { getAuthorityConfig, getTabConfig } from "../../../config/sheetsConfig.js";
import { readSheetRows } from "../../../lib/googleSheets.js";
import { readAuthorizedUsers, readOfficeSources } from "../../../lib/registry.js";
import { refreshRegistryUsers } from "../../../lib/registryUsers.js";
import { saveReport } from "../../../lib/reportCache.js";
import { buildDashboard } from "../../../lib/reports.js";
import { prepareRowsForStore } from "../../../lib/sheetRowMapper.js";
import { resolveDataTabs } from "../../../lib/tabResolver.js";
import { flushPersistence, isPersistenceEnabled } from "../../../lib/store.js";

export const runtime = "nodejs";

function ingestSecret(env = process.env) {
  return String(env.INGEST_SECRET || "").trim();
}

function providedSecret(request, url) {
  const header = request.headers.get("x-ingest-secret");
  if (header) {
    return header;
  }
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return url.searchParams.get("secret") || "";
}

function guard(request, url) {
  const secret = ingestSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set INGEST_SECRET to use the registry endpoints." },
      { status: 503 },
    );
  }
  if (providedSecret(request, url) !== secret) {
    return NextResponse.json({ ok: false, error: "Invalid ingest secret" }, { status: 401 });
  }
  return null;
}

// Lists the Google Sheets discovered in the Bot Authority registry.
export async function GET(request) {
  const url = new URL(request.url);
  const denied = guard(request, url);
  if (denied) {
    return denied;
  }

  try {
    const sources = await readOfficeSources();
    const payload = {
      ok: true,
      authoritySpreadsheetId: getAuthorityConfig().spreadsheetId,
      count: sources.length,
      sources,
    };
    if (url.searchParams.get("includeUsers") === "1") {
      payload.users = await readAuthorizedUsers();
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  }
}

// Registry-driven sync: reads each office sheet listed in Bot Authority and
// stores it. Optional ?sourceKey= or ?period= narrows the sync to avoid
// serverless timeouts on large registries.
export async function POST(request) {
  const url = new URL(request.url);
  const denied = guard(request, url);
  if (denied) {
    return denied;
  }

  const onlySourceKey = url.searchParams.get("sourceKey");
  const onlyPeriod = url.searchParams.get("period");
  const leadsConfig = getTabConfig("leads");
  const authorityCfg = getAuthorityConfig();

  try {
    let sources = await readOfficeSources();
    if (onlySourceKey) {
      sources = sources.filter((source) => source.sourceKey === onlySourceKey);
    } else if (onlyPeriod) {
      sources = sources.filter((source) => source.period === onlyPeriod);
    }

    const results = [];
    for (const source of sources) {
      try {
        // Each office file may name its data tab differently; detect the right
        // tab(s) by matching the CRM column headers.
        const tabs = await resolveDataTabs(source.spreadsheetId, leadsConfig, {
          fallbackTab: authorityCfg.dataTab,
        });
        const combinedRows = [];
        for (const tab of tabs) {
          const rows = await readSheetRows("leads", {
            tabConfig: { ...leadsConfig, range: tab.range },
            spreadsheetId: source.spreadsheetId,
            cache: false,
          });
          for (const row of rows) {
            combinedRows.push(row);
          }
        }
        const prepared = prepareRowsForStore(combinedRows, leadsConfig, {
          office: source.office,
          period: source.period,
        });
        // Precompute the compact dashboard for this source and cache it (small,
        // KV-friendly, durable). Raw rows are not stored.
        const dashboard = buildDashboard(prepared, leadsConfig, {}, new Date(), { limit: 10 });
        saveReport(
          source.sourceKey,
          { office: source.office, period: source.period },
          dashboard,
        );
        results.push({
          sourceKey: source.sourceKey,
          tabs: tabs.map((tab) => tab.title),
          stored: prepared.length,
          totalLeads: dashboard.summary.totalLeads,
          totalFtd: dashboard.summary.totalFtd,
          cr: dashboard.summary.cr,
        });
      } catch (error) {
        results.push({
          sourceKey: source.sourceKey,
          error: String(error?.message || error).slice(0, 200),
        });
      }
    }

    // Refresh authorized users from the registry's users tab alongside the data.
    let authorizedUsers = null;
    try {
      const result = await refreshRegistryUsers({ force: true });
      authorizedUsers = result.count;
    } catch (error) {
      console.error("Registry user refresh failed", error);
    }

    return NextResponse.json({
      ok: true,
      synced: results.filter((result) => !result.error).length,
      failed: results.filter((result) => result.error).length,
      authorizedUsers,
      persisted: isPersistenceEnabled(),
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  } finally {
    await flushPersistence().catch(() => {});
  }
}
