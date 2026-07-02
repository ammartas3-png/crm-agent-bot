import { isPersistenceEnabled, storeGet, storeSet } from "./store.js";

const memoryBuckets = new Map();
const MAX_MEMORY_BUCKETS = 5000;

function ttlMs(env = process.env, prefix = "RATE_LIMIT") {
  const raw = Number(env[`${prefix}_WINDOW_MS`]);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 60_000;
}

function limitFor(env = process.env, prefix = "RATE_LIMIT") {
  const raw = Number(env[`${prefix}_MAX`]);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return prefix.includes("BOT") ? 20 : 40;
}

function pruneMemoryBuckets(now = Date.now()) {
  if (memoryBuckets.size <= MAX_MEMORY_BUCKETS) {
    return;
  }
  for (const [key, entry] of memoryBuckets.entries()) {
    if (now - entry.windowStart > entry.windowMs) {
      memoryBuckets.delete(key);
    }
    if (memoryBuckets.size <= MAX_MEMORY_BUCKETS * 0.8) {
      break;
    }
  }
}

async function incrementCounter(redisKey, windowMs) {
  const raw = await storeGet(redisKey);
  const next = Number(raw || 0) + 1;
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  await storeSet(redisKey, String(next), ttlSeconds);
  return next;
}

export async function checkRateLimit(key, options = {}) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY };
  }
  const prefix = String(options.prefix || "RATE_LIMIT").trim() || "RATE_LIMIT";
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : ttlMs(process.env, prefix);
  const max = Number(options.max) > 0 ? Number(options.max) : limitFor(process.env, prefix);
  const now = Date.now();
  pruneMemoryBuckets(now);

  let count = 0;
  let windowStart = now;
  const memoryEntry = memoryBuckets.get(normalizedKey);
  if (!memoryEntry || now - memoryEntry.windowStart >= windowMs) {
    memoryBuckets.set(normalizedKey, { windowStart: now, windowMs, count: 1 });
    count = 1;
  } else {
    memoryEntry.count += 1;
    count = memoryEntry.count;
    windowStart = memoryEntry.windowStart;
  }

  if (isPersistenceEnabled()) {
    try {
      const redisKey = `crm:ratelimit:${prefix}:${normalizedKey}`;
      count = Math.max(count, await incrementCounter(redisKey, windowMs));
      memoryBuckets.set(normalizedKey, { windowStart: now, windowMs, count });
    } catch (error) {
      console.error("Rate limit Redis check failed", error);
    }
  }

  const allowed = count <= max;
  const retryAfterMs = allowed ? 0 : Math.max(0, windowMs - (now - windowStart));
  return {
    allowed,
    remaining: Math.max(0, max - count),
    retryAfterMs,
    limit: max,
  };
}

export function rateLimitKeyFromTelegramUser(telegramUser = {}) {
  const id = Number(telegramUser?.id || 0);
  if (id > 0) {
    return `tg:${id}`;
  }
  const username = String(telegramUser?.username || "").trim().toLowerCase();
  return username ? `tg:@${username}` : "tg:unknown";
}

export function rateLimitKeyFromDashboardUser(telegramUser = {}, access = null) {
  const id = Number(telegramUser?.id || 0);
  const scope = access?.authorityScope?.unrestricted
    ? "all"
    : JSON.stringify(access?.permissionFilters || {});
  return id > 0 ? `dash:${id}:${scope}` : `dash:${scope}`;
}
