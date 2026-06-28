import { setRegistryAllowedUsers } from "./permissions.js";
import { readAuthorizedUsers } from "./registry.js";

// Authorizing from the Bot Authority "users" tab reads Google Sheets, so it is
// opt-in and TTL-cached to keep the webhook hot path fast.

let lastRefreshAt = 0;
let lastCount = 0;

export function isRegistryAuthEnabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.AUTHORIZE_FROM_REGISTRY || "").trim());
}

function refreshTtlMs(env = process.env) {
  const raw = Number(env.REGISTRY_USERS_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return 10 * 60 * 1000;
}

// Reads the users tab and applies it to the permission layer. TTL-guarded unless
// forced (e.g. right after a registry sync).
export async function refreshRegistryUsers(options = {}) {
  if (!options.force && Date.now() - lastRefreshAt < refreshTtlMs()) {
    return { skipped: true, count: lastCount };
  }
  const principals = await readAuthorizedUsers(options);
  const applied = setRegistryAllowedUsers(principals);
  lastRefreshAt = Date.now();
  lastCount = applied.length;
  return { skipped: false, count: applied.length };
}

export function resetRegistryUsersCache() {
  lastRefreshAt = 0;
  lastCount = 0;
}
