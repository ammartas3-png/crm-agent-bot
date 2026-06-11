import { NextResponse } from "next/server";

import { refreshOfficeDeskLanguageBenchmarks } from "../../../../lib/dashboardService.js";

export const maxDuration = 300;

function isAuthorized(request) {
  const secret = String(process.env.BENCHMARK_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const authorization = String(request.headers.get("authorization") || "").trim();
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (secret) {
    return bearerToken === secret;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

async function handleRefresh(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshOfficeDeskLanguageBenchmarks();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "benchmark_refresh_failed",
        message: error?.message || "Could not refresh benchmark cache.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  return handleRefresh(request);
}

export async function POST(request) {
  return handleRefresh(request);
}
