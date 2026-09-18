import { NextResponse } from "next/server";

export const runtime = "nodejs";

// The manual table upload feature is temporarily disabled (page under
// maintenance). Both GET and POST report the same maintenance status so no
// uploads are accepted while it is paused.
function maintenanceResponse() {
  return NextResponse.json(
    { ok: false, error: "maintenance", message: "Upload is temporarily unavailable." },
    { status: 503 },
  );
}

export async function GET() {
  return maintenanceResponse();
}

export async function POST() {
  return maintenanceResponse();
}
