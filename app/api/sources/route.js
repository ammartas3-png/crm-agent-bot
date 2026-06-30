import { NextResponse } from "next/server";

import { getAuthorityConfig, getTabConfig } from "../../../config/sheetsConfig.js";
import { readAuthorizedUsers, readOfficeSources } from "../../../lib/registry.js";
import { refreshRegistryUsers } from "../../../lib/registryUsers.js";
import { syncOfficeSourceToStore } from "../../../lib/registrySync.js";
import { flushPersistence, isPersistenceEnabled } from "../../../lib/store.js";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const ftdConfig = getTabConfig("ftd");
  const infoAgentsConfig = getTabConfig("infoAgents");
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
        const result = await syncOfficeSourceToStore(source, {
          leadsConfig,
          ftdConfig,
          infoAgentsConfig,
          authorityConfig: authorityCfg,
        });
        results.push(result);
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
