import { NextResponse } from "next/server";

import { dashboardSessionCookieName } from "../../../../../lib/dashboardAuth.js";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(dashboardSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
