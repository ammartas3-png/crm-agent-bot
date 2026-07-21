import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadApprovedDepositsReport } from "../../../../lib/approvedDepositsService.js";
import { logDashboardActivity } from "../../../../lib/activityLogService.js";
import { dashboardActivityFromQuery } from "../../../../lib/dashboardActivity.js";

export const maxDuration = 300;

function queryParams(searchParams) {
  return {
    language: String(searchParams.get("language") || "All").trim(),
    country: String(searchParams.get("country") || "All").trim(),
    month: String(searchParams.get("month") || "All").trim(),
    status: String(searchParams.get("status") || "All").trim(),
    brand: String(searchParams.get("brand") || "All").trim(),
    campaign: String(searchParams.get("campaign") || "All").trim(),
    method: String(searchParams.get("method") || "All").trim(),
    cashier: String(searchParams.get("cashier") || "All").trim(),
    department: String(searchParams.get("department") || "All").trim(),
    ftd: String(searchParams.get("ftd") || "All").trim(),
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
    const report = await loadApprovedDepositsReport(query);
    const activity = dashboardActivityFromQuery(query, { action: "approved_deposits", page: "Approved Deposits" });
    logDashboardActivity(resolved.telegramUser, activity.action, {
      ...activity.details,
      page: "Approved Deposits",
      officeScope: activity.office,
      monthKey: activity.month,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "approved_deposits_report_failed",
        message: error?.message || "Could not load approved deposits report.",
      },
      { status: 500 },
    );
  }
}

