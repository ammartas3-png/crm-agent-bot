import { Redis } from "@upstash/redis";

import { dashboardPerfLog } from "./dashboardPerf.js";

const MEMORY_CACHE_MAX = 300;
const REDIS_OP_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.REDIS_OP_TIMEOUT_MS || 1200);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
})();
const REDIS_COOLDOWN_MS = (() => {
  const parsed = Number(process.env.REDIS_COOLDOWN_MS || 120000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
})();
const memoryCache = new Map();
const localInflight = new Map();
let redisClient = null;
let redisInitAttempted = false;
let redisDisabledUntilMs = 0;

function pruneMemoryCache() {
  if (memoryCache.size <= MEMORY_CACHE_MAX) {
    return;
  }
  const oldest = [...memoryCache.entries()].sort(
    (left, right) => Number(left[1]?.expiresAt || 0) - Number(right[1]?.expiresAt || 0),
  );
  while (memoryCache.size > MEMORY_CACHE_MAX && oldest.length) {
    const [key] = oldest.shift();
    memoryCache.delete(key);
  }
}

function disableRedisTemporarily(reason = "", error = null) {
  redisDisabledUntilMs = Date.now() + REDIS_COOLDOWN_MS;
  dashboardPerfLog("CACHE_REDIS_TEMP_DISABLED", {
    reason,
    cooldownMs: REDIS_COOLDOWN_MS,
    message: String(error?.message || error || ""),
  });
}

function redisTemporarilyDisabled() {
  return redisDisabledUntilMs > Date.now();
}

async function withOpTimeout(operation = "", key = "", promiseFactory) {
  let timerId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const timeoutError = new Error(`Redis ${operation} timeout after ${REDIS_OP_TIMEOUT_MS}ms`);
        timeoutError.code = "redis_timeout";
        reject(timeoutError);
      }, REDIS_OP_TIMEOUT_MS);
      if (typeof timerId?.unref === "function") {
        timerId.unref();
      }
    });
    const pendingPromise = Promise.resolve().then(() => promiseFactory());
    return await Promise.race([pendingPromise, timeoutPromise]);
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

function writeMemoryCache(key = "", value = null, ttlSeconds = 0) {
  if (!key || value === null || value === undefined || !Number.isFinite(Number(ttlSeconds)) || Number(ttlSeconds) <= 0) {
    return;
  }
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + Number(ttlSeconds) * 1000,
  });
  pruneMemoryCache();
}

function readMemoryCache(key = "") {
  if (!key) {
    return null;
  }
  const cached = memoryCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() > Number(cached.expiresAt || 0)) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value;
}

function parseRedisCredentials() {
  const token = String(process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN || "").trim();
  const kvUrl = String(process.env.KV_REST_API_URL || "").trim();
  const redisUrl = String(process.env.REDIS_URL || "").trim();
  const selectedUrl = kvUrl || (redisUrl.startsWith("http") ? redisUrl : "");
  if (!token || !selectedUrl) {
    return null;
  }
  return {
    url: selectedUrl,
    token,
  };
}

function redis() {
  if (redisTemporarilyDisabled()) {
    dashboardPerfLog("CACHE_REDIS_DISABLED_TEMPORARY", { untilMs: redisDisabledUntilMs });
    return null;
  }
  if (redisClient) {
    return redisClient;
  }
  if (redisInitAttempted) {
    return null;
  }
  redisInitAttempted = true;
  try {
    const credentials = parseRedisCredentials();
    if (!credentials) {
      dashboardPerfLog("CACHE_REDIS_DISABLED", {
        hasKvUrl: Boolean(process.env.KV_REST_API_URL),
        hasKvToken: Boolean(process.env.KV_REST_API_TOKEN),
        hasRedisUrl: Boolean(process.env.REDIS_URL),
      });
      return null;
    }
    redisClient = new Redis({
      url: credentials.url,
      token: credentials.token,
    });
    dashboardPerfLog("CACHE_REDIS_READY", { provider: "upstash" });
    return redisClient;
  } catch (error) {
    dashboardPerfLog("CACHE_REDIS_INIT_FAILED", { message: String(error?.message || error || "") });
    return null;
  }
}

function sleep(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

async function releaseLock(lockKey = "", lockToken = "") {
  const client = redis();
  if (!client || !lockKey || !lockToken) {
    return;
  }
  try {
    dashboardPerfLog("CACHE_LOCK_RELEASE_START", { lockKey });
    const current = await withOpTimeout("get", lockKey, () => client.get(lockKey));
    if (String(current || "") === String(lockToken || "")) {
      await withOpTimeout("del", lockKey, () => client.del(lockKey));
      dashboardPerfLog("CACHE_LOCK_RELEASED", { lockKey });
      return;
    }
    dashboardPerfLog("CACHE_LOCK_RELEASE_SKIPPED", { lockKey, reason: "token_mismatch" });
  } catch (error) {
    disableRedisTemporarily("lock_release_failed", error);
    dashboardPerfLog("CACHE_LOCK_RELEASE_FAILED", {
      lockKey,
      message: String(error?.message || error || ""),
      stack: String(error?.stack || ""),
    });
  }
}

export async function readCachedJson(key = "", options = {}) {
  const {
    cacheScope = "generic",
    cacheLabel = "",
    logMiss = true,
    memoryOnly = false,
    memoryTtlSeconds = 30,
  } = options;
  if (!key) {
    return null;
  }
  const memoryValue = readMemoryCache(key);
  if (memoryValue !== null) {
    dashboardPerfLog("CACHE_HIT", { cacheScope, cacheLabel, storage: "memory", key });
    return memoryValue;
  }
  if (memoryOnly) {
    if (logMiss) {
      dashboardPerfLog("CACHE_MISS", { cacheScope, cacheLabel, storage: "memory", key });
    }
    return null;
  }
  const client = redis();
  if (!client) {
    if (logMiss) {
      dashboardPerfLog("CACHE_MISS", { cacheScope, cacheLabel, storage: "none", key });
    }
    return null;
  }
  try {
    const startedAt = Date.now();
    dashboardPerfLog("CACHE_GET_START", { cacheScope, cacheLabel, key });
    const value = await withOpTimeout("get", key, () => client.get(key));
    if (value === null || value === undefined) {
      if (logMiss) {
        dashboardPerfLog("CACHE_MISS", { cacheScope, cacheLabel, storage: "redis", key });
      }
      return null;
    }
    if (Number(memoryTtlSeconds) > 0) {
      writeMemoryCache(key, value, Number(memoryTtlSeconds));
    }
    dashboardPerfLog("CACHE_GET_DONE", {
      cacheScope,
      cacheLabel,
      key,
      ms: Date.now() - startedAt,
    });
    dashboardPerfLog("CACHE_HIT", { cacheScope, cacheLabel, storage: "redis", key });
    return value;
  } catch (error) {
    disableRedisTemporarily("get_failed", error);
    dashboardPerfLog("CACHE_GET_FAILED", {
      cacheScope,
      cacheLabel,
      key,
      message: String(error?.message || error || ""),
    });
    return null;
  }
}

export async function writeCachedJson(key = "", value = null, ttlSeconds = 0, options = {}) {
  const { cacheScope = "generic", cacheLabel = "", memoryTtlSeconds = 30 } = options;
  if (!key || value === null || value === undefined || !Number.isFinite(Number(ttlSeconds)) || Number(ttlSeconds) <= 0) {
    return;
  }
  if (Number(memoryTtlSeconds) > 0) {
    writeMemoryCache(key, value, Number(memoryTtlSeconds));
  }
  const client = redis();
  if (!client) {
    dashboardPerfLog("CACHE_SET", { cacheScope, cacheLabel, storage: "memory", key, ttlSeconds });
    return;
  }
  try {
    const startedAt = Date.now();
    dashboardPerfLog("CACHE_SET_START", { cacheScope, cacheLabel, key, ttlSeconds });
    await withOpTimeout("set", key, () => client.set(key, value, { ex: Math.max(1, Number(ttlSeconds) || 1) }));
    dashboardPerfLog("CACHE_SET_DONE", {
      cacheScope,
      cacheLabel,
      key,
      ttlSeconds,
      ms: Date.now() - startedAt,
    });
    dashboardPerfLog("CACHE_SET", { cacheScope, cacheLabel, storage: "redis", key, ttlSeconds });
  } catch (error) {
    disableRedisTemporarily("set_failed", error);
    dashboardPerfLog("CACHE_SET_FAILED", {
      cacheScope,
      cacheLabel,
      key,
      ttlSeconds,
      message: String(error?.message || error || ""),
    });
  }
}

export async function loadWithCacheSingleflight({
  freshKey = "",
  staleKey = "",
  freshTtlSeconds = 0,
  staleTtlSeconds = 0,
  loader,
  cacheScope = "generic",
  cacheLabel = "",
  shouldUseStaleOnError = null,
  lockTtlSeconds = 120,
  waitTimeoutMs = 5_000,
}) {
  if (!freshKey || typeof loader !== "function") {
    return loader();
  }
  const cached = await readCachedJson(freshKey, { cacheScope, cacheLabel });
  if (cached !== null) {
    return cached;
  }
  if (localInflight.has(freshKey)) {
    return localInflight.get(freshKey);
  }
  const pending = (async () => {
    const client = redis();
    const lockKey = `lock:${freshKey}`;
    const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let hasLock = false;
    let lockAcquireFailed = false;
    if (client) {
      try {
        dashboardPerfLog("CACHE_LOCK_ACQUIRE_START", { lockKey, lockTtlSeconds });
        const lockResponse = await withOpTimeout("set", lockKey, () =>
          client.set(lockKey, lockToken, {
            nx: true,
            ex: Math.max(10, Number(lockTtlSeconds) || 120),
          }),
        );
        hasLock = String(lockResponse || "").toUpperCase() === "OK";
        dashboardPerfLog("CACHE_LOCK_ACQUIRE_DONE", {
          lockKey,
          acquired: hasLock,
          rawResponse: String(lockResponse || ""),
        });
      } catch (error) {
        hasLock = false;
        lockAcquireFailed = true;
        disableRedisTemporarily("lock_acquire_failed", error);
        dashboardPerfLog("CACHE_LOCK_ACQUIRE_FAILED", {
          lockKey,
          message: String(error?.message || error || ""),
          stack: String(error?.stack || ""),
        });
      }
      if (!hasLock && !lockAcquireFailed) {
        // If lock exists elsewhere, one short wait is enough; do not block report execution.
        const waitStartedAt = Date.now();
        let waitMs = 200;
        while (Date.now() - waitStartedAt < waitTimeoutMs) {
          const waited = await readCachedJson(freshKey, {
            cacheScope,
            cacheLabel,
            logMiss: false,
            memoryTtlSeconds: 5,
          });
          if (waited !== null) {
            return waited;
          }
          await sleep(waitMs);
          waitMs = Math.min(waitMs * 2, 1000);
        }
        dashboardPerfLog("CACHE_LOCK_WAIT_TIMEOUT", {
          lockKey,
          waitTimeoutMs,
        });
      }
      if (lockAcquireFailed) {
        dashboardPerfLog("CACHE_LOCK_BYPASS", {
          lockKey,
          reason: "acquire_failed",
        });
      }
    }
    try {
      const value = await loader();
      if (Number(freshTtlSeconds) > 0) {
        await writeCachedJson(freshKey, value, freshTtlSeconds, {
          cacheScope,
          cacheLabel,
          memoryTtlSeconds: Math.min(Number(freshTtlSeconds), 60),
        });
      }
      if (staleKey && Number(staleTtlSeconds) > 0) {
        await writeCachedJson(staleKey, value, staleTtlSeconds, {
          cacheScope,
          cacheLabel: `${cacheLabel}:stale`,
          memoryTtlSeconds: 0,
        });
      }
      return value;
    } catch (error) {
      const allowStale = typeof shouldUseStaleOnError === "function" ? shouldUseStaleOnError(error) : false;
      if (allowStale && staleKey) {
        dashboardPerfLog("STALE_CACHE_LOOKUP", {
          cacheScope,
          cacheLabel,
          key: staleKey,
        });
        const staleValue = await readCachedJson(staleKey, {
          cacheScope,
          cacheLabel: `${cacheLabel}:stale`,
          memoryTtlSeconds: 5,
        });
        if (staleValue !== null) {
          dashboardPerfLog("STALE_CACHE_USED", { cacheScope, cacheLabel, key: staleKey });
          return staleValue;
        }
        dashboardPerfLog("STALE_CACHE_MISS", { cacheScope, cacheLabel, key: staleKey });
      }
      throw error;
    } finally {
      if (hasLock) {
        await releaseLock(lockKey, lockToken);
      }
    }
  })().finally(() => {
    if (localInflight.get(freshKey) === pending) {
      localInflight.delete(freshKey);
    }
  });
  localInflight.set(freshKey, pending);
  return pending;
}

export function clearDashboardRedisMemoryCache() {
  memoryCache.clear();
  localInflight.clear();
}
