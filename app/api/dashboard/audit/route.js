import { NextResponse } from "next/server";

import { runQuickReportAudit } from "../../../../lib/quickReportAuditRunner.js";
import { QUICK_REPORT_PRESET_KEYS } from "../../../../lib/quickReportPresets.js";

export const maxDuration = 300;

function ingestSecret(env = process.env) {
  return String(env.INGEST_SECRET || "").trim();
}

function providedSecret(request) {
  const header = request.headers.get("x-ingest-secret");
  if (header) {
    return header;
  }
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  try {
    return new URL(request.url).searchParams.get("secret") || "";
  } catch {
    return "";
  }
}

export async function GET(request) {
  const secret = ingestSecret();
  if (!secret || providedSecret(request) !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const office = String(url.searchParams.get("office") || "").trim();
  const preset = String(url.searchParams.get("preset") || "").trim();
  const monthKey = String(url.searchParams.get("monthKey") || "").trim();
  const maxRuns = Math.max(1, Math.min(80, Number(url.searchParams.get("maxRuns")) || 40));

  try {
    const result = await runQuickReportAudit({
      offices: office ? [office] : [],
      presets: preset ? [preset] : QUICK_REPORT_PRESET_KEYS,
      monthKey,
      maxRuns,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "audit_failed",
        message: error?.message || "Quick report audit failed.",
      },
      { status: 500 },
    );
  }
}
