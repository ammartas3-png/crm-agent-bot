import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";

export const maxDuration = 300;
const REPORT_ROUTE_TIMEOUT_MS = 240_000;
const REPORT_CACHE_TTL_MS = 90_000;
const REPORT_CACHE_MAX_ENTRIES = 40;
const reportCache = new Map();
const reportInflight = new Map();

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function reportCacheKey(access = {}, query = {}) {
  return JSON.stringify({
    permissionFilters: stableValue(access?.permissionFilters || {}),
    query: stableValue(query || {}),
  });
}

function pruneReportCache() {
  if (reportCache.size <= REPORT_CACHE_MAX_ENTRIES) {
    return;
  }
  const oldest = [...reportCache.entries()].sort(
    (left, right) => Number(left[1]?.timestamp || 0) - Number(right[1]?.timestamp || 0),
  );
  while (reportCache.size > REPORT_CACHE_MAX_ENTRIES && oldest.length) {
    const [key] = oldest.shift();
    reportCache.delete(key);
  }
}

function readReportCache(key = "") {
  if (!key) {
    return null;
  }
  const cached = reportCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.timestamp || 0) >= REPORT_CACHE_TTL_MS) {
    reportCache.delete(key);
    return null;
  }
  return cached.report || null;
}

function writeReportCache(key = "", report = null) {
  if (!key || !report) {
    return;
  }
  reportCache.set(key, {
    timestamp: Date.now(),
    report,
  });
  pruneReportCache();
}

async function loadReportWithCache(key = "", loader) {
  const cached = readReportCache(key);
  if (cached) {
    return cached;
  }
  if (key && reportInflight.has(key)) {
    return reportInflight.get(key);
  }
  const pending = Promise.resolve()
    .then(() => loader())
    .then((report) => {
      writeReportCache(key, report);
      return report;
    })
    .finally(() => {
      if (key && reportInflight.get(key) === pending) {
        reportInflight.delete(key);
      }
    });
  if (key) {
    reportInflight.set(key, pending);
  }
  return pending;
}

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

function queryParams(searchParams) {
  return {
    monthKey: String(searchParams.get("monthKey") || "").trim(),
    officeScope: String(searchParams.get("officeScope") || "").trim(),
    reportMode: String(searchParams.get("reportMode") || "").trim(),
    specificType: String(searchParams.get("specificType") || "").trim(),
    date: String(searchParams.get("date") || "").trim(),
    hour: String(searchParams.get("hour") || "").trim(),
    desk: String(searchParams.get("desk") || "").trim(),
    country: String(searchParams.get("country") || "").trim(),
    brand: String(searchParams.get("brand") || "").trim(),
    campaign: String(searchParams.get("campaign") || "").trim(),
    subCampaign: String(searchParams.get("subCampaign") || "").trim(),
    placement: String(searchParams.get("placement") || "").trim(),
    status: String(searchParams.get("status") || "").trim(),
    teamLeader: String(searchParams.get("teamLeader") || "").trim(),
    agent: String(searchParams.get("agent") || "").trim(),
    groupBy: String(searchParams.get("groupBy") || "").trim(),
    rowDimensions: String(searchParams.get("rowDimensions") || "").trim(),
    metricFields: String(searchParams.get("metricFields") || "").trim(),
    totalDimensions: String(searchParams.get("totalDimensions") || "").trim(),
    columnDimension: String(searchParams.get("columnDimension") || "").trim(),
    includeColumnGrandTotal: String(searchParams.get("includeColumnGrandTotal") || "").trim(),
    agentProductivityPlanMode: String(searchParams.get("agentProductivityPlanMode") || "").trim(),
    last4QuickMode: String(searchParams.get("last4QuickMode") || "").trim(),
    includeWorkTime: String(searchParams.get("includeWorkTime") || "").trim(),
    hideNotWorking: String(searchParams.get("hideNotWorking") || "").trim(),
  };
}

export async function GET(request) {
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const query = queryParams(new URL(request.url).searchParams);
    const cacheKey = reportCacheKey(resolved.access, query);
    const report = await withTimeout(
      loadReportWithCache(cacheKey, () => loadDashboardReport(resolved.access, query)),
      REPORT_ROUTE_TIMEOUT_MS,
    );
    return NextResponse.json({ ok: true, report });
  } catch (error) {
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
