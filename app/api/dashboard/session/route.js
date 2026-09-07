import { NextResponse } from "next/server";

import { dashboardBootstrap } from "../../../../lib/dashboardService.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { getTelegramBotUsername } from "../../../../lib/telegramBotProfile.js";
import { hasTelegramBotToken } from "../../../../lib/telegram.js";

export async function GET(request) {
  const botUsername = await getTelegramBotUsername().catch(() => "");
  const authInfo = {
    enabled: hasTelegramBotToken() && Boolean(botUsername),
    botUsername,
  };
  const resolved = await dashboardAccessFromRequest(request);
  if (!resolved.authenticated) {
    return NextResponse.json({
      authenticated: false,
      authorized: false,
      auth: authInfo,
    });
  }
  if (!resolved.access?.authorized) {
    return NextResponse.json({
      authenticated: true,
      authorized: false,
      auth: authInfo,
      user: resolved.telegramUser,
    });
  }
  const bootstrap = await dashboardBootstrap(resolved.access).catch(() => ({
    months: [],
    defaultMonthKey: "",
    officeScopes: [],
    lastSyncAt: null,
  }));
  return NextResponse.json({
    authenticated: true,
    authorized: true,
    auth: authInfo,
    user: resolved.telegramUser,
    bootstrap,
  });
}
