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

// Loads a persisted session into memory after a cold start. The in-memory copy
// always wins when present, so this is a no-op for warm instances.
export async function hydrateSession(userId) {
  if (userId === undefined || userId === null) {
    return;
  }
  const key = String(userId);
  if (sessions.has(key)) {
    return;
  }
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
