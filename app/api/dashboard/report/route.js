import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { mapDashboardServiceError } from "../../../../lib/dashboardApiErrors.js";
import { isEnabledFlag, parseDashboardQueryFromSearchParams } from "../../../../lib/dashboardQuery.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { createRequestId, logAndAlertError, logEvent } from "../../../../lib/opsLogger.js";

export const maxDuration = 300;

export async function GET(request) {
  const requestId = createRequestId("dashboard-report");
  const startedAt = Date.now();
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const query = parseDashboardQueryFromSearchParams(new URL(request.url).searchParams);
    if (isEnabledFlag(query.monitor)) {
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
            logEvent("info", "dashboard_report_stream_completed", {
              requestId,
              elapsedMs: Date.now() - startedAt,
              reportMode: String(query.reportMode || ""),
              officeScope: String(query.officeScope || ""),
            });
            writeEvent({ type: "result", report });
          } catch (error) {
            const errorCode = String(error?.code || "").trim();
            const isTooHeavy = errorCode === "report_too_heavy";
            await logAndAlertError("dashboard_report_stream_failed", {
              requestId,
              elapsedMs: Date.now() - startedAt,
              error: isTooHeavy ? "report_too_heavy" : "report_route_failed",
              message: error?.message || "Could not load report.",
              stage: error?.stage || latestProgress.step || "",
              reportMode: String(query.reportMode || ""),
              officeScope: String(query.officeScope || ""),
            });
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
    logEvent("info", "dashboard_report_completed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      reportMode: String(query.reportMode || ""),
      officeScope: String(query.officeScope || ""),
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const mapped = mapDashboardServiceError(error, "report_route_failed");
    await logAndAlertError("dashboard_report_failed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      ...mapped.body,
    });
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
