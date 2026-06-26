import { storeGet, storeSet, storeSetAdd, storeSetMembers, storeSetRemove } from "./store.js";

export const UNAUTHORIZED_MESSAGE = "You are not authorized to use this bot.";
export const DEFAULT_ADMIN_USERS = ["@antoniotsd", "@Cuervo0o0o", "@talhapervaiz97"];

const APPROVED_USERS_KEY = "crm:approved_users";
const REGISTRY_USERS_KEY = "crm:registry_users";
const runtimeApprovedUsers = new Set();
// Users authorized via the Bot Authority "users" tab.
const registryAllowedUsers = new Set();

export function normalizePrincipal(value) {
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

export function parseAdminChatIds(rawAdminChatIds = process.env.ADMIN_CHAT_IDS || "") {
  return [...parseUserList(rawAdminChatIds)];
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
  if (principals.some((principal) => runtimeApprovedUsers.has(principal))) {
    return "user";
  }

  if (principals.some((principal) => registryAllowedUsers.has(principal))) {
    return "user";
  }

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

export function approveTelegramUser(userOrId) {
  const principals = telegramUserPrincipals(userOrId);
  for (const principal of principals) {
    runtimeApprovedUsers.add(principal);
    storeSetAdd(APPROVED_USERS_KEY, principal);
  }
  return principals;
}

export function denyTelegramUser(userOrId) {
  const principals = telegramUserPrincipals(userOrId);
  for (const principal of principals) {
    runtimeApprovedUsers.delete(principal);
    storeSetRemove(APPROVED_USERS_KEY, principal);
  }
  return principals;
}

export function clearRuntimeApprovals() {
  runtimeApprovedUsers.clear();
}

// Re-populates approved users from the persistent store after a cold start.
export async function hydrateApprovedUsers() {
  const members = await storeSetMembers(APPROVED_USERS_KEY);
  for (const principal of members) {
    if (principal) {
      runtimeApprovedUsers.add(String(principal));
    }
  }
}

// Replaces the set of users authorized via the Bot Authority "users" tab and
// mirrors it to the persistent store (so cold starts can re-hydrate it).
export function setRegistryAllowedUsers(principals = []) {
  registryAllowedUsers.clear();
  const normalized = [];
  for (const value of principals) {
    const principal = normalizePrincipal(value);
    if (principal) {
      registryAllowedUsers.add(principal);
      normalized.push(principal);
    }
  }
  storeSet(REGISTRY_USERS_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function hydrateRegistryAllowedUsers() {
  const raw = await storeGet(REGISTRY_USERS_KEY);
  if (!raw) {
    return;
  }
  try {
    const principals = JSON.parse(raw);
    if (Array.isArray(principals)) {
      registryAllowedUsers.clear();
      for (const principal of principals) {
        if (principal) {
          registryAllowedUsers.add(String(principal));
        }
      }
    }
  } catch {
    // Ignore malformed persisted user lists.
  }
}

export function clearRegistryAllowedUsers() {
  registryAllowedUsers.clear();
}
