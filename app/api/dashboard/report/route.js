import { NextResponse } from "next/server";

import { loadWithCacheSingleflight } from "../../../../lib/dashboardRedisCache.js";
import { dashboardPerfLog, hashStableValue, shouldUseStaleReport, stableValue } from "../../../../lib/dashboardPerf.js";
import { dashboardQueryParams } from "../../../../lib/dashboardQuery.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";

export const maxDuration = 300;
const REPORT_ROUTE_TIMEOUT_MS = 240_000;
const REPORT_CACHE_TTL_SECONDS = 5 * 60;
const REPORT_STALE_TTL_SECONDS = 24 * 60 * 60;

function reportTimeoutError(timeoutMs) {
  const error = new Error("Report request timed out before completion.");
  error.code = "report_timeout";
  error.timeoutMs = timeoutMs;
  return error;
}

function withTimeout(promise, timeoutMs) {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(reportTimeoutError(timeoutMs)), timeoutMs);
    if (typeof timerId?.unref === "function") {
      timerId.unref();
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId) {
      clearTimeout(timerId);
    }
  });
}

function statusForRouteError(error) {
  if (error?.code === "report_timeout") {
    return 504;
  }
  if (error?.code === "report_too_heavy") {
    return 422;
  }
  return 500;
}

function messageForRouteError(error) {
  if (error?.code === "report_timeout") {
    return "Report timed out while loading Google Sheets. Narrow Date/Country/Campaign filters and retry, or wait a moment and retry.";
  }
  return error?.message || "Could not load report.";
}

function reportCacheHash(access = {}, query = {}) {
  return hashStableValue({
    permissionFilters: stableValue(access?.permissionFilters || {}),
    query: stableValue(query || {}),
  });
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
        route: "dashboard/report",
        prefix: "report",
        hashPrefix: String(reportHash || "").slice(0, 16),
      });
    } catch (error) {
      dashboardPerfLog("CACHE_KEY_GENERATION_FAILED", {
        route: "dashboard/report",
        message: String(error?.message || error || ""),
        stack: String(error?.stack || ""),
      });
      reportHash = "";
    }
    const freshKey = reportHash ? `report:${reportHash}` : "";
    const staleKey = reportHash ? `report:stale:${reportHash}` : "";
    dashboardPerfLog("REPORT_REQUEST", {
      reportMode: query.reportMode || "monthly",
      officeScope: query.officeScope || "",
      monthKey: query.monthKey || "",
    });
    const report = await withTimeout(
      loadWithCacheSingleflight({
        freshKey,
        staleKey,
        freshTtlSeconds: REPORT_CACHE_TTL_SECONDS,
        staleTtlSeconds: REPORT_STALE_TTL_SECONDS,
        cacheScope: "report",
        cacheLabel: query.reportMode || "monthly",
        shouldUseStaleOnError: shouldUseStaleReport,
        loader: () => loadDashboardReport(resolved.access, query),
      }),
      REPORT_ROUTE_TIMEOUT_MS,
    );
    dashboardPerfLog("TOTAL_EXECUTION_TIME", {
      route: "dashboard/report",
      ms: Date.now() - routeStartedAt,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    dashboardPerfLog("REPORT_ROUTE_ERROR", {
      route: "dashboard/report",
      code: String(error?.code || ""),
      stage: String(error?.stage || ""),
      message: String(error?.message || ""),
      stack: String(error?.stack || ""),
    });
    if (error?.code === "report_timeout") {
      dashboardPerfLog("GOOGLE_SHEETS_TIMEOUT", { route: "dashboard/report", timeoutMs: REPORT_ROUTE_TIMEOUT_MS });
    }
    const status = statusForRouteError(error);
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.code || "report_route_failed"),
        message: messageForRouteError(error),
        timeoutMs: Number(error?.timeoutMs || 0) || undefined,
        stage: String(error?.stage || ""),
      },
      { status },
    );
  }
}
