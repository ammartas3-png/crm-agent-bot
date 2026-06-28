import { NextResponse } from "next/server";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { createDateRangeFilter } from "../../../lib/calculations.js";
import { loadLeadRows } from "../../../lib/dataProvider.js";
import { buildDashboard } from "../../../lib/reports.js";

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

function buildFilters(url, now) {
  const params = url.searchParams;
  const filters = {};
  for (const key of ["country", "office", "teamLeader", "brand", "campaign", "status"]) {
    const value = params.get(key);
    if (value) {
      filters[key] = value;
    }
  }
  const agent = params.get("agent");
  if (agent) {
    filters.agent = agent;
    filters.agentField = "agentNames";
  }

  const start = params.get("start");
  const end = params.get("end");
  if (start && end) {
    filters.date = { type: "range", start, end };
  } else {
    const dateKey = params.get("date");
    if (dateKey && dateKey !== "all") {
      if (dateKey === "today") {
        filters.date = { type: "today" };
      } else {
        const range = createDateRangeFilter(dateKey, now);
        if (range?.filter) {
          filters.date = range.filter;
        }
      }
    }
  }
  return filters;
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
  const tabConfig = getTabConfig("leads");
  const filters = buildFilters(url, now);
  const type = (url.searchParams.get("type") || "all").toLowerCase();
  const limit = Number(url.searchParams.get("limit")) || 10;

  try {
    const rows = await loadLeadRows("leads", { tabConfig });
    const dashboard = buildDashboard(rows, tabConfig, filters, now, { limit });

    if (type === "summary") {
      return NextResponse.json({
        ok: true,
        rowCount: dashboard.rowCount,
        filters,
        summary: dashboard.summary,
      });
    }
    if (type === "quick") {
      return NextResponse.json({ ok: true, filters, quick: dashboard.quick });
    }
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  }
}
