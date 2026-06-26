// Optional persistent key-value store for runtime state (sessions, approvals,
// admin chats, access requests). It is a thin wrapper over an Upstash / Vercel
// KV REST endpoint and uses `fetch` only, so it adds no npm dependency and works
// on serverless runtimes.
//
// When no backend is configured every operation is a safe no-op: reads return
// empty values and writes resolve immediately. The in-memory structures in the
// consuming modules remain the synchronous source of truth; this store only
// mirrors writes and is used to re-hydrate memory after a cold start.

function kvConfig(env = process.env) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return { url, token };
}

export function isPersistenceEnabled(env = process.env) {
  const { url, token } = kvConfig(env);
  return Boolean(url && token);
}

const pendingWrites = new Set();

function trackWrite(promise) {
  const tracked = Promise.resolve(promise).catch((error) => {
    console.error("Persistent store write failed", error);
  });
  pendingWrites.add(tracked);
  tracked.finally(() => pendingWrites.delete(tracked));
  return tracked;
}

// Awaits all in-flight writes. Callers (e.g. the webhook handler) flush before
// responding so serverless instances do not get frozen mid-write.
export async function flushPersistence() {
  if (pendingWrites.size === 0) {
    return;
  }
  await Promise.allSettled([...pendingWrites]);
}

async function redisCommand(args, env = process.env) {
  const { url, token } = kvConfig(env);
  if (!url || !token) {
    return null;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`Persistent store command failed: ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  return data?.result ?? null;
}

export async function storeGet(key) {
  if (!isPersistenceEnabled()) {
    return null;
  }
  return redisCommand(["GET", key]);
}

export async function storeSetMembers(setKey) {
  if (!isPersistenceEnabled()) {
    return [];
  }
  const result = await redisCommand(["SMEMBERS", setKey]);
  return Array.isArray(result) ? result : [];
}

export function storeSet(key, value, ttlSeconds) {
  if (!isPersistenceEnabled()) {
    return Promise.resolve();
  }
  const args = ttlSeconds
    ? ["SET", key, value, "EX", String(ttlSeconds)]
    : ["SET", key, value];
  return trackWrite(redisCommand(args));
}

export function storeDelete(key) {
  if (!isPersistenceEnabled()) {
    return Promise.resolve();
  }
  return trackWrite(redisCommand(["DEL", key]));
}

export function storeSetAdd(setKey, member) {
  if (!isPersistenceEnabled()) {
    return Promise.resolve();
  }
  return trackWrite(redisCommand(["SADD", setKey, member]));
}

export function storeSetRemove(setKey, member) {
  if (!isPersistenceEnabled()) {
    return Promise.resolve();
  }
  return trackWrite(redisCommand(["SREM", setKey, member]));
}
