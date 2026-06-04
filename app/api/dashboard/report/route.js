import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { loadDashboardReport } from "../../../../lib/dashboardService.js";

function queryParams(searchParams) {
  return {
    monthKey: String(searchParams.get("monthKey") || "").trim(),
    officeScope: String(searchParams.get("officeScope") || "").trim(),
    desk: String(searchParams.get("desk") || "").trim(),
    country: String(searchParams.get("country") || "").trim(),
    brand: String(searchParams.get("brand") || "").trim(),
    teamLeader: String(searchParams.get("teamLeader") || "").trim(),
    agent: String(searchParams.get("agent") || "").trim(),
    campaign: String(searchParams.get("campaign") || "").trim(),
    groupBy: String(searchParams.get("groupBy") || "").trim(),
  };
}

export async function GET(request) {
  const resolved = await dashboardAccessFromRequest(request);
  if (!resolved.authenticated) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!resolved.access?.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const query = queryParams(new URL(request.url).searchParams);
  try {
    const report = await loadDashboardReport(resolved.access, query);
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "report_generation_failed",
        message: error?.message || "Could not load report.",
      },
      { status: 500 },
    );
  }
}
