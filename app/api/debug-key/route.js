import { NextResponse } from "next/server";

import { debugKeyStatus } from "../../../lib/debugKey.js";

export async function GET() {
  return NextResponse.json(debugKeyStatus());
}
