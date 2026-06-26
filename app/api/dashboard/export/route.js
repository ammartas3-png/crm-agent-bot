import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { mapDashboardServiceError } from "../../../../lib/dashboardApiErrors.js";
import { parseDashboardQueryFromSearchParams } from "../../../../lib/dashboardQuery.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { dashboardReportWorkbookBuffer } from "../../../../lib/dashboardWorkbookExporter.js";
import { createRequestId, logAndAlertError, logEvent } from "../../../../lib/opsLogger.js";

export const maxDuration = 300;

function safeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export async function GET(request) {
  const requestId = createRequestId("dashboard-export");
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
    const report = await loadDashboardReport(resolved.access, query);
    const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
    const office = safeName(report?.month?.office_name || query.officeScope || "office");
    const month = safeName(report?.month?.key || query.monthKey || "month");
    const mode = safeName(report?.reportMode || "report");
    const filename = `crm-${mode}-${office}-${month}.xlsx`;
    return new NextResponse(workbookBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
    logEvent("info", "dashboard_export_completed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      filename,
      reportMode: String(query.reportMode || ""),
      officeScope: String(query.officeScope || ""),
    });
    return response;
  } catch (error) {
    const mapped = mapDashboardServiceError(error, "export_route_failed");
    await logAndAlertError("dashboard_export_failed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      ...mapped.body,
    });
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

