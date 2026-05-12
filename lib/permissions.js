export const UNAUTHORIZED_MESSAGE = "You are not authorized to use this bot.";
export const DEFAULT_ADMIN_USERS = ["@antoniotsd"];

function normalizePrincipal(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase("en-US");
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

export function parseUserList(rawUsers = "") {
  return new Set(
    String(rawUsers)
      .split(",")
      .map(normalizePrincipal)
      .filter(Boolean),
  );
}

export function parseAllowedUsers(rawAllowedUsers = process.env.ALLOWED_USERS || "") {
  return parseUserList(rawAllowedUsers);
}

export function parseAdminUsers(rawAdminUsers = process.env.ADMIN_USERS || DEFAULT_ADMIN_USERS.join(",")) {
  return parseUserList(rawAdminUsers);
}

export function telegramUserPrincipals(userOrId) {
  if (userOrId === undefined || userOrId === null) {
    return [];
  }

  if (typeof userOrId === "object") {
    return [
      userOrId.id,
      userOrId.username,
      userOrId.user_name,
      userOrId.first_name,
    ]
      .map(normalizePrincipal)
      .filter(Boolean);
  }

  return [normalizePrincipal(userOrId)].filter(Boolean);
}

export function isAdminTelegramUser(
  userOrId,
  adminUsers = parseAdminUsers(),
) {
  const principals = telegramUserPrincipals(userOrId);
  return principals.some((principal) => adminUsers.has(principal));
}

export function getTelegramUserRole(
  userOrId,
  allowedUsers = parseAllowedUsers(),
  adminUsers = parseAdminUsers(),
) {
  if (isAdminTelegramUser(userOrId, adminUsers)) {
    return "admin";
  }

  const principals = telegramUserPrincipals(userOrId);
  if (principals.some((principal) => allowedUsers.has(principal))) {
    return "user";
  }

  return "none";
}

export function isAllowedTelegramUser(
  userOrId,
  allowedUsers = parseAllowedUsers(),
  adminUsers = parseAdminUsers(),
) {
  return getTelegramUserRole(userOrId, allowedUsers, adminUsers) !== "none";
}
