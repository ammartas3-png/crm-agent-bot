import { NextResponse } from "next/server";

import {
  createDashboardSessionToken,
  dashboardSessionCookieName,
  dashboardSessionCookieOptions,
  verifyTelegramLoginPayload,
} from "../../../../../lib/dashboardAuth.js";
import { resolveDashboardAccess } from "../../../../../lib/dashboardService.js";
import { logDashboardActivity } from "../../../../../lib/activityLogService.js";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const verified = verifyTelegramLoginPayload(payload || {});
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });
  }
  const telegramUser = verified.user;
  const access = await resolveDashboardAccess(telegramUser);
  if (!access.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized_user" }, { status: 403 });
  }
  const token = createDashboardSessionToken(telegramUser);
  logDashboardActivity(telegramUser, "login", {
    username: telegramUser.username || "",
    officeScope: access?.defaultOfficeScope || "",
  });
  const response = NextResponse.json({
    ok: true,
    user: telegramUser,
  });
  response.cookies.set(dashboardSessionCookieName(), token, dashboardSessionCookieOptions());
  return response;
}
