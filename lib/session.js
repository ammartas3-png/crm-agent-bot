const sessions = new Map();

export function getSession(userId) {
  const key = String(userId);
  if (!sessions.has(key)) {
    sessions.set(key, {});
  }
  return sessions.get(key);
}

export function setSession(userId, nextSession) {
  sessions.set(String(userId), {
    ...getSession(userId),
    ...nextSession,
    updatedAt: Date.now(),
  });
  return getSession(userId);
}

export function clearSession(userId) {
  sessions.delete(String(userId));
}
