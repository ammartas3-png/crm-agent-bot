// Optional persistent key-value store for runtime state (sessions, approvals,
// ingested CRM rows, report cache). Supports either:
//   1. Upstash / Vercel KV REST (KV_REST_API_URL + KV_REST_API_TOKEN)
//   2. Standard Redis TCP (REDIS_URL), e.g. Redis Cloud redis://...
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

function redisUrl(env = process.env) {
  return String(env.REDIS_URL || "").trim();
}

export function isPersistenceEnabled(env = process.env) {
  const { url, token } = kvConfig(env);
  if (url && token) {
    return true;
  }
  return Boolean(redisUrl(env));
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

export async function flushPersistence() {
  if (pendingWrites.size === 0) {
    return;
  }
  await Promise.allSettled([...pendingWrites]);
}

let tcpClient = null;
let tcpConnectPromise = null;

async function getTcpRedis(env = process.env) {
  const url = redisUrl(env);
  if (!url) {
    return null;
  }
  if (tcpClient?.isOpen) {
    return tcpClient;
  }
  if (!tcpConnectPromise) {
    const { createClient } = await import("redis");
    tcpClient = createClient({ url });
    tcpClient.on("error", (error) => {
      console.error("Redis TCP error", error);
    });
    tcpConnectPromise = tcpClient.connect().then(() => tcpClient);
  }
  try {
    return await tcpConnectPromise;
  } catch (error) {
    tcpConnectPromise = null;
    tcpClient = null;
    throw error;
  }
}

async function redisCommand(args, env = process.env) {
  const { url, token } = kvConfig(env);
  if (url && token) {
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

  const client = await getTcpRedis(env);
  if (!client) {
    return null;
  }

  const [command, ...rest] = args;
  const upper = String(command || "").toUpperCase();
  switch (upper) {
    case "GET":
      return client.get(rest[0]);
    case "MGET":
      return client.mGet(rest);
    case "SET": {
      if (rest.length >= 4 && String(rest[2]).toUpperCase() === "EX") {
        return client.set(rest[0], rest[1], { EX: Number(rest[3]) });
      }
      return client.set(rest[0], rest[1]);
    }
    case "DEL":
      return client.del(rest);
    case "SADD":
      return client.sAdd(rest[0], rest.slice(1));
    case "SREM":
      return client.sRem(rest[0], rest.slice(1));
    case "SMEMBERS":
      return client.sMembers(rest[0]);
    default:
      throw new Error(`Unsupported Redis command: ${upper}`);
  }
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

export async function storeMGet(keys = []) {
  if (!isPersistenceEnabled() || keys.length === 0) {
    return [];
  }
  const result = await redisCommand(["MGET", ...keys]);
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
