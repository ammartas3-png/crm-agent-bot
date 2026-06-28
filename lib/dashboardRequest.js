import { dashboardSessionCookieName, verifyDashboardSessionToken } from "./dashboardAuth.js";
import { resolveDashboardAccess } from "./dashboardService.js";

function normalizeTelegramUserFromSession(payload = {}) {
  return {
    id: Number(payload.id) || 0,
    username: String(payload.username || "").trim(),
    first_name: String(payload.first_name || "").trim(),
    last_name: String(payload.last_name || "").trim(),
  };
}

export function dashboardUserFromRequest(request) {
  const token = request.cookies.get(dashboardSessionCookieName())?.value || "";
  const payload = verifyDashboardSessionToken(token);
  if (!payload) {
    return null;
  }
  return normalizeTelegramUserFromSession(payload);
}

export async function dashboardAccessFromRequest(request) {
  const telegramUser = dashboardUserFromRequest(request);
  if (!telegramUser) {
    return {
      authenticated: false,
      access: null,
      telegramUser: null,
    };
  }
  const access = await resolveDashboardAccess(telegramUser);
  return {
    authenticated: true,
    access,
    telegramUser,
  };
}
