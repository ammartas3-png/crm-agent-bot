import { NextResponse } from "next/server";

import { loadWithCacheSingleflight } from "../../../../lib/dashboardRedisCache.js";
import { dashboardPerfLog, hashStableValue, shouldUseStaleReport, stableValue } from "../../../../lib/dashboardPerf.js";
import { dashboardQueryFromString } from "../../../../lib/dashboardQuery.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";

export const maxDuration = 300;
const DETAILS_BUNDLE_TIMEOUT_MS = 240_000;
const DETAILS_BUNDLE_CACHE_TTL_SECONDS = 5 * 60;
const DETAILS_BUNDLE_STALE_TTL_SECONDS = 24 * 60 * 60;

function reportTimeoutError(timeoutMs) {
  const error = new Error("Detailed report bundle timed out before completion.");
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

function parseMonthKeys(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusForError(error) {
  if (error?.code === "report_timeout") {
    return 504;
  }
  if (error?.code === "report_too_heavy") {
    return 422;
  }
  return 500;
}

export async function POST(request) {
  const startedAt = Date.now();
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const breakdownQuery = String(body?.breakdownQuery || "").trim();
    const trendQuery = String(body?.trendQuery || "").trim();
    const leadsQuery = String(body?.leadsQuery || "").trim();
    const benchmarkQuery = String(body?.benchmarkQuery || "").trim();
    const benchmarkRowsQuery = String(body?.benchmarkRowsQuery || "").trim();
    const monthSummaryBaseQuery = String(body?.monthSummaryBaseQuery || "").trim();
    const contextMonthKeys = parseMonthKeys(body?.contextMonthKeys || []);

    if (!breakdownQuery || !trendQuery || !leadsQuery || !benchmarkQuery || !benchmarkRowsQuery || !monthSummaryBaseQuery) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_request",
          message: "Missing details bundle query payload.",
        },
        { status: 400 },
      );
    }

    const cacheHash = hashStableValue({
      permissionFilters: stableValue(resolved.access?.permissionFilters || {}),
      bundle: {
        breakdownQuery,
        trendQuery,
        leadsQuery,
        benchmarkQuery,
        benchmarkRowsQuery,
        monthSummaryBaseQuery,
        contextMonthKeys,
      },
    });

    const payload = await withTimeout(
      loadWithCacheSingleflight({
        freshKey: `report:${cacheHash}`,
        staleKey: `report:stale:${cacheHash}`,
        freshTtlSeconds: DETAILS_BUNDLE_CACHE_TTL_SECONDS,
        staleTtlSeconds: DETAILS_BUNDLE_STALE_TTL_SECONDS,
        cacheScope: "report-bundle",
        cacheLabel: "details",
        shouldUseStaleOnError: shouldUseStaleReport,
        loader: async () => {
          const breakdownReportQuery = dashboardQueryFromString(breakdownQuery);
          const trendReportQuery = dashboardQueryFromString(trendQuery);
          const leadsReportQuery = dashboardQueryFromString(leadsQuery);
          const benchmarkReportQuery = dashboardQueryFromString(benchmarkQuery);
          const benchmarkRowsReportQuery = dashboardQueryFromString(benchmarkRowsQuery);

          const [breakdownReport, trendReport, leadsReport, benchmarkReport, benchmarkRowsReport] = await Promise.all([
            loadDashboardReport(resolved.access, breakdownReportQuery),
            loadDashboardReport(resolved.access, trendReportQuery),
            loadDashboardReport(resolved.access, leadsReportQuery),
            loadDashboardReport(resolved.access, benchmarkReportQuery),
            loadDashboardReport(resolved.access, benchmarkRowsReportQuery),
          ]);

          const monthOptions = Array.isArray(breakdownReport?.options?.months) ? breakdownReport.options.months : [];
          const monthKeysFromOptions = monthOptions.map((month) => String(month?.key || "").trim()).filter(Boolean);
          const last4MonthKeys = [...new Set(monthKeysFromOptions.length ? monthKeysFromOptions : contextMonthKeys)].slice(0, 4);
          const monthLabelByKey = new Map(
            monthOptions
              .map((month) => [String(month?.key || "").trim(), String(month?.month_label || month?.label || month?.key || "").trim()])
              .filter(([key]) => Boolean(key)),
          );

          const monthSummaryBase = dashboardQueryFromString(monthSummaryBaseQuery);
          const last4Rows = await Promise.all(
            last4MonthKeys.map(async (monthKey) => {
              const monthReport = await loadDashboardReport(resolved.access, {
                ...monthSummaryBase,
                monthKey,
              });
              return {
                monthKey,
                monthLabel: monthLabelByKey.get(monthKey) || monthKey,
                summary: monthReport?.summary || {},
              };
            }),
          );

          return {
            breakdownReport,
            trendReport,
            leadsReport,
            benchmarkReport,
            benchmarkRowsReport,
            last4Rows,
          };
        },
      }),
      DETAILS_BUNDLE_TIMEOUT_MS,
    );

    dashboardPerfLog("TOTAL_EXECUTION_TIME", {
      route: "dashboard/details-bundle",
      ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      payload,
    });
  } catch (error) {
    if (error?.code === "report_timeout") {
      dashboardPerfLog("GOOGLE_SHEETS_TIMEOUT", { route: "dashboard/details-bundle", timeoutMs: DETAILS_BUNDLE_TIMEOUT_MS });
    }
    return NextResponse.json(
      {
        ok: false,
        error: String(error?.code || "details_bundle_failed"),
        message: String(error?.message || "Could not load details bundle."),
      },
      { status: statusForError(error) },
    );
  }
}
