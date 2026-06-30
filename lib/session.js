import { storeDelete, storeGet, storeSet } from "./store.js";

const sessions = new Map();

const SESSION_PREFIX = "crm:session:";
const SESSION_TTL_SECONDS = 60 * 60;

function sessionKey(userId) {
  return `${SESSION_PREFIX}${String(userId)}`;
}

export function getSession(userId) {
  const key = String(userId);
  if (!sessions.has(key)) {
    sessions.set(key, {});
  }
  return sessions.get(key);
}

export function setSession(userId, nextSession) {
  const key = String(userId);
  const merged = {
    ...getSession(userId),
    ...nextSession,
    updatedAt: Date.now(),
  };
  sessions.set(key, merged);
  storeSet(sessionKey(userId), JSON.stringify(merged), SESSION_TTL_SECONDS);
  return merged;
}

export function clearSession(userId) {
  sessions.delete(String(userId));
  storeDelete(sessionKey(userId));
}

// Loads the persisted session from KV at the start of each request. Because the
// webhook flushes writes to KV before responding, KV holds the latest committed
// state, so it is authoritative across serverless instances. We always refresh
// from KV (even on warm instances) so a flag set on another instance — e.g. AI
// mode — is visible here. When KV has no value, the in-memory session is kept.
export async function hydrateSession(userId) {
  if (userId === undefined || userId === null) {
    return;
  }
  const key = String(userId);
  const raw = await storeGet(sessionKey(userId));
  if (!raw) {
    return;
  }
  try {
    sessions.set(key, JSON.parse(raw));
  } catch {
    // Ignore malformed persisted sessions and fall back to a fresh session.
  }
}
