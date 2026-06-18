import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";

export const maxDuration = 300;
const REPORT_ROUTE_TIMEOUT_MS = 55_000;

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
    return "Report timed out while loading Google Sheets. Narrow Date/Country/Campaign filters and retry.";
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
    const report = await withTimeout(loadDashboardReport(resolved.access, query), REPORT_ROUTE_TIMEOUT_MS);
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
