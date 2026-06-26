import { NextResponse } from "next/server";

import { getAuthorityConfig, getTabConfig } from "../../../config/sheetsConfig.js";
import { readSheetRows } from "../../../lib/googleSheets.js";
import { saveSource } from "../../../lib/leadsStore.js";
import { readAuthorizedUsers, readOfficeSources } from "../../../lib/registry.js";
import { prepareRowsForStore } from "../../../lib/sheetRowMapper.js";
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
        const tabConfig = { ...leadsConfig, range: source.range || leadsConfig.range };
        const rows = await readSheetRows("leads", {
          tabConfig,
          spreadsheetId: source.spreadsheetId,
          cache: false,
        });
        const prepared = prepareRowsForStore(rows, leadsConfig, {
          office: source.office,
          period: source.period,
        });
        saveSource(source.sourceKey, source, prepared);
        results.push({ sourceKey: source.sourceKey, stored: prepared.length });
      } catch (error) {
        results.push({
          sourceKey: source.sourceKey,
          error: String(error?.message || error).slice(0, 200),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      synced: results.filter((result) => !result.error).length,
      failed: results.filter((result) => result.error).length,
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
