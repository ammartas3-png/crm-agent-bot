import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";
import { dashboardReportWorkbookBuffer } from "../../../../lib/dashboardWorkbookExporter.js";
import { logReportEvent } from "../../../../lib/reportLog.js";

// Large exports (full report + workbook build) can take longer than the
// platform default. Match the report route so downloads don't get cut off.
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
    columnDimension2: String(searchParams.get("columnDimension2") || "").trim(),
    includeColumnGrandTotal: String(searchParams.get("includeColumnGrandTotal") || "").trim(),
    agentProductivityPlanMode: String(searchParams.get("agentProductivityPlanMode") || "").trim(),
    comparisonMode: String(searchParams.get("comparisonMode") || "").trim(),
    leadSplitter: String(searchParams.get("leadSplitter") || "").trim(),
    trafficPriority: String(searchParams.get("trafficPriority") || "").trim(),
    tpCountry: String(searchParams.get("tpCountry") || "").trim(),
    tpCountries: String(searchParams.get("tpCountries") || "").trim(),
    tpCampaign: String(searchParams.get("tpCampaign") || "").trim(),
    tpCount: String(searchParams.get("tpCount") || "").trim(),
    tpExclude: String(searchParams.get("tpExclude") || "").trim(),
    last4QuickMode: String(searchParams.get("last4QuickMode") || "").trim(),
    includeWorkTime: String(searchParams.get("includeWorkTime") || "").trim(),
    hideNotWorking: String(searchParams.get("hideNotWorking") || "").trim(),
    showHrCode: String(searchParams.get("showHrCode") || "").trim(),
    reportName: String(searchParams.get("reportName") || "").trim(),
    sourceUrl: String(searchParams.get("sourceUrl") || "").trim(),
  };
}

function safeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// Derives the exported report's display name when the client did not send one
// (custom Report Builder rather than a named quick report).
function fallbackReportName(query) {
  const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
  if (truthy(query.trafficPriority)) return "Traffic Distribution";
  if (truthy(query.leadSplitter)) return "LeadSplitter";
  if (truthy(query.comparisonMode)) return "Comparison Report";
  if (truthy(query.agentProductivityPlanMode)) return "Agent Productivity vs Plan";
  if (truthy(query.last4QuickMode)) return "Last 4 Months";
  if (truthy(query.benchmarkMode)) return "Benchmark";
  const dims = String(query.rowDimensions || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return dims.length ? `Report Builder ${dims.join("-")}` : "Report Builder";
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
    const searchParams = new URL(request.url).searchParams;
    const query = queryParams(searchParams);
    void logReportEvent({ telegramUser: resolved.telegramUser, searchParams, action: "export" });
    const report = await loadDashboardReport(resolved.access, query);
    const workbookBuffer = await dashboardReportWorkbookBuffer(report, query, {
      exportedBy: resolved.telegramUser,
      sourceUrl: query.sourceUrl,
      reportName: query.reportName,
    });
    // Filename: "<Office> - <Month> <Date> - <Report Name>.xlsx".
    const office = safeName(report?.month?.office_name || query.officeScope || "Office");
    const month = safeName(report?.month?.label || report?.month?.key || query.monthKey || "");
    const date = safeName(query.date || "");
    const reportName = safeName(query.reportName || fallbackReportName(query));
    const period = [month, date].filter(Boolean).join(" ");
    const filename = `${[office, period, reportName].filter(Boolean).join(" - ")}.xlsx`;
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

