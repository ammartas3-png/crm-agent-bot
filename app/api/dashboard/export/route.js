import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { dashboardReportWorkbookBuffer } from "../../../../lib/dashboardWorkbookExporter.js";

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
    comparisonMode: String(searchParams.get("comparisonMode") || "").trim(),
    leadSplitter: String(searchParams.get("leadSplitter") || "").trim(),
    last4QuickMode: String(searchParams.get("last4QuickMode") || "").trim(),
    includeWorkTime: String(searchParams.get("includeWorkTime") || "").trim(),
    hideNotWorking: String(searchParams.get("hideNotWorking") || "").trim(),
    hideHrCode: String(searchParams.get("hideHrCode") || "").trim(),
  };
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
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const query = queryParams(new URL(request.url).searchParams);
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
  } catch (error) {
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

