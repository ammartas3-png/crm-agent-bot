import { isAdminTelegramUser } from "./permissions.js";

export const ACTIONS = {
  RESULTS_CHECK: "results_check",
  DATABASE_CHECK: "database_check",
};

const ACTION_ROLE_MATRIX = {
  [ACTIONS.RESULTS_CHECK]: new Set(["user", "admin"]),
  [ACTIONS.DATABASE_CHECK]: new Set(["admin"]),
};

function rolesForUser(telegramUser) {
  return isAdminTelegramUser(telegramUser) ? ["admin", "user"] : ["user"];
}

export function canAccessAction(telegramUser, action) {
  const allowedRoles = ACTION_ROLE_MATRIX[action];
  if (!allowedRoles) {
    return false;
  }
  const roles = rolesForUser(telegramUser);
  return roles.some((role) => allowedRoles.has(role));
}
