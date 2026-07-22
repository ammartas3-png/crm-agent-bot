import { NextResponse } from "next/server";

import { dashboardAccessFromRequest } from "../../../../../lib/dashboardRequest.js";
import { diagnoseKycLanguages } from "../../../../../lib/approvedDepositsService.js";

export const maxDuration = 300;

export async function GET(request) {
  try {
    const resolved = await dashboardAccessFromRequest(request);
    if (!resolved.authenticated) {
      return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
    }
    if (!resolved.access?.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
    const diagnosis = await diagnoseKycLanguages();
    return NextResponse.json({ ok: true, diagnosis });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "approved_deposits_diagnosis_failed",
        message: error?.message || "Could not diagnose KYC languages.",
      },
      { status: 500 },
    );
  }
}
