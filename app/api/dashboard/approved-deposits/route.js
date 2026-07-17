import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../../lib/dashboardRequest.js";
import { loadApprovedDepositsReport } from "../../../../../lib/approvedDepositsService.js";

export const maxDuration = 300;

function queryParams(searchParams) {
  return {
    language: String(searchParams.get("language") || "All").trim(),
    country: String(searchParams.get("country") || "All").trim(),
    month: String(searchParams.get("month") || "All").trim(),
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
    const report = await loadApprovedDepositsReport(queryParams(new URL(request.url).searchParams));
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

