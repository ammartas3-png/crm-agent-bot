import { NextResponse } from "next/server";

import { getReportsBy } from "../../../lib/reportCache.js";
import { mergeDashboards } from "../../../lib/reports.js";

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

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

// Resolves the cache filter from query params. Supported scopes:
//   ?office=&period=YYYY-MM  -> one office, one month
//   ?office=                 -> one office, all cached months
//   ?period=YYYY-MM          -> all offices, one month
//   ?months=N (+office?)     -> last N months up to now
//   (none)                   -> everything cached
function cacheFilter(url, now) {
  const params = url.searchParams;
  const filter = {};
  const office = params.get("office");
  if (office) {
    filter.office = office;
  }
  const period = params.get("period");
  if (period) {
    filter.period = period;
  }
  const months = Number(params.get("months"));
  if (!period && Number.isFinite(months) && months > 0) {
    const periods = [];
    for (let index = 0; index < months; index += 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
      periods.push(monthKey(date.getUTCFullYear(), date.getUTCMonth()));
    }
    filter.periods = periods;
  }
  return filter;
}

export async function GET(request) {
  const url = new URL(request.url);
  const secret = ingestSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set INGEST_SECRET to use the report endpoint." },
      { status: 503 },
    );
  }
  if (providedSecret(request, url) !== secret) {
    return NextResponse.json({ ok: false, error: "Invalid ingest secret" }, { status: 401 });
  }

  const now = new Date();
  const type = (url.searchParams.get("type") || "all").toLowerCase();
  const filter = cacheFilter(url, now);

  try {
    const entries = await getReportsBy(filter);
    if (entries.length === 0) {
      return NextResponse.json({
        ok: true,
        empty: true,
        scope: filter,
        message: "No precomputed report for this scope. Run POST /api/sources first.",
      });
    }

    const dashboard = mergeDashboards(entries.map((entry) => entry.dashboard));
    const meta = {
      scope: filter,
      sources: entries.length,
      periods: [...new Set(entries.map((entry) => entry.period))].sort(),
      offices: [...new Set(entries.map((entry) => entry.office))].sort(),
    };

    if (type === "summary") {
      return NextResponse.json({ ok: true, ...meta, rowCount: dashboard.rowCount, summary: dashboard.summary });
    }
    if (type === "quick") {
      return NextResponse.json({ ok: true, ...meta, quick: dashboard.quick });
    }
    return NextResponse.json({ ok: true, ...meta, ...dashboard });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  }
}
