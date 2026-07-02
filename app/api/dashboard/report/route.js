import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import {
  getCachedDashboardReport,
  setCachedDashboardReport,
} from "../../../../lib/dashboardReportCache.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { checkRateLimit, rateLimitKeyFromDashboardUser } from "../../../../lib/rateLimit.js";

export const maxDuration = 300;

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
    benchmarkMode: String(searchParams.get("benchmarkMode") || "").trim(),
    benchmarkHydrate: String(searchParams.get("benchmarkHydrate") || "").trim(),
    debugDiagnostics: String(searchParams.get("debugDiagnostics") || "").trim(),
    page: String(searchParams.get("page") || "").trim(),
    rowLimit: String(searchParams.get("rowLimit") || "").trim(),
    monitor: String(searchParams.get("monitor") || "").trim(),
  };
}

function asBool(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
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
    const rateLimit = await checkRateLimit(rateLimitKeyFromDashboardUser(resolved.telegramUser, resolved.access), {
      prefix: "DASHBOARD_RATE_LIMIT",
      max: Number(process.env.DASHBOARD_RATE_LIMIT_MAX) > 0 ? Number(process.env.DASHBOARD_RATE_LIMIT_MAX) : 40,
      windowMs:
        Number(process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS) > 0 ? Number(process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS) : 60_000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many report requests. Please wait a moment and try again.",
          retryAfterMs: rateLimit.retryAfterMs,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(Number(rateLimit.retryAfterMs || 0) / 1000))),
          },
        },
      );
    }
    const cachedReport = await getCachedDashboardReport(resolved.access, query);
    if (cachedReport) {
      return NextResponse.json(
        { ok: true, report: cachedReport, cached: true },
        {
          headers: {
            "Cache-Control": "private, max-age=60",
          },
        },
      );
    }
    if (asBool(query.monitor)) {
      const encoder = new TextEncoder();
      let latestProgress = {
        startTime: new Date().toISOString(),
        elapsedMs: 0,
        step: "Loading Google Sheets",
        progress: 0,
        totalRowsLoaded: 0,
        rowsAfterFiltering: 0,
        rowsProcessed: 0,
      };
      const stream = new ReadableStream({
        async start(controller) {
          const writeEvent = (payload) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };
          writeEvent({ type: "progress", ...latestProgress });
          try {
            const report = await loadDashboardReport(resolved.access, query, {
              onProgress: (event) => {
                latestProgress = {
                  ...latestProgress,
                  ...event,
                };
                writeEvent({ type: "progress", ...latestProgress });
              },
            });
            writeEvent({ type: "result", report });
          } catch (error) {
            const errorCode = String(error?.code || "").trim();
            const isTooHeavy = errorCode === "report_too_heavy";
            writeEvent({
              type: "error",
              ok: false,
              error: isTooHeavy ? "report_too_heavy" : "report_route_failed",
              message: error?.message || "Could not load report.",
              stage: error?.stage || latestProgress.step || "",
              elapsedMs: latestProgress.elapsedMs || 0,
              totalRowsLoaded: latestProgress.totalRowsLoaded || 0,
              rowsAfterFiltering: latestProgress.rowsAfterFiltering || 0,
              rowsProcessed: latestProgress.rowsProcessed || 0,
              currentSheet: latestProgress.currentSheet || "",
              currentTab: latestProgress.currentTab || "",
            });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    const report = await loadDashboardReport(resolved.access, query);
    await setCachedDashboardReport(resolved.access, query, report);
    return NextResponse.json(
      { ok: true, report },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    );
  } catch (error) {
    const errorCode = String(error?.code || "").trim();
    const isTooHeavy = errorCode === "report_too_heavy";
    return NextResponse.json(
      {
        ok: false,
        error: isTooHeavy ? "report_too_heavy" : "report_route_failed",
        message: error?.message || "Could not load report.",
        stage: error?.stage || "",
      },
      { status: isTooHeavy ? 422 : 500 },
    );
  }
}
