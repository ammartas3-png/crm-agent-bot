import { NextResponse } from "next/server";

import { loadWithCacheSingleflight } from "../../../../lib/dashboardRedisCache.js";
import { dashboardPerfLog, hashStableValue, shouldUseStaleReport, stableValue } from "../../../../lib/dashboardPerf.js";
import { dashboardQueryParams } from "../../../../lib/dashboardQuery.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { dashboardReportWorkbookBuffer } from "../../../../lib/dashboardWorkbookExporter.js";

const REPORT_CACHE_TTL_SECONDS = 5 * 60;
const REPORT_STALE_TTL_SECONDS = 24 * 60 * 60;

function reportCacheHash(access = {}, query = {}) {
  return hashStableValue({
    permissionFilters: stableValue(access?.permissionFilters || {}),
    query: stableValue(query || {}),
  });
}

function safeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export async function GET(request) {
  const routeStartedAt = Date.now();
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const query = dashboardQueryParams(new URL(request.url).searchParams);
    let reportHash = "";
    try {
      reportHash = reportCacheHash(resolved.access, query);
      dashboardPerfLog("CACHE_KEY_GENERATED", {
        route: "dashboard/export",
        prefix: "report",
        hashPrefix: String(reportHash || "").slice(0, 16),
      });
    } catch (error) {
      dashboardPerfLog("CACHE_KEY_GENERATION_FAILED", {
        route: "dashboard/export",
        message: String(error?.message || error || ""),
        stack: String(error?.stack || ""),
      });
      reportHash = "";
    }
    const report = await loadWithCacheSingleflight({
      freshKey: reportHash ? `report:${reportHash}` : "",
      staleKey: reportHash ? `report:stale:${reportHash}` : "",
      freshTtlSeconds: REPORT_CACHE_TTL_SECONDS,
      staleTtlSeconds: REPORT_STALE_TTL_SECONDS,
      cacheScope: "report",
      cacheLabel: `export:${query.reportMode || "monthly"}`,
      shouldUseStaleOnError: shouldUseStaleReport,
      loader: () => loadDashboardReport(resolved.access, query),
    });
    const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
    const office = safeName(report?.month?.office_name || query.officeScope || "office");
    const month = safeName(report?.month?.key || query.monthKey || "month");
    const mode = safeName(report?.reportMode || "report");
    const filename = `crm-${mode}-${office}-${month}.xlsx`;
    const response = new NextResponse(workbookBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
    dashboardPerfLog("TOTAL_EXECUTION_TIME", {
      route: "dashboard/export",
      ms: Date.now() - routeStartedAt,
    });
    return response;
  } catch (error) {
    dashboardPerfLog("REPORT_ROUTE_ERROR", {
      route: "dashboard/export",
      code: String(error?.code || ""),
      stage: String(error?.stage || ""),
      message: String(error?.message || ""),
      stack: String(error?.stack || ""),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "export_route_failed",
        message: error?.message || "Could not export report.",
      },
      { status: 500 },
    );
  }
}

