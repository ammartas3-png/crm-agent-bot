import { isPersistenceEnabled, storeGet, storeSet } from "./store.js";

// Two-tier cache: a fast per-instance in-memory layer plus an optional shared
// Redis/KV layer (when configured) so multiple serverless instances can reuse
// the same computed result.

const memory = new Map();
const REDIS_VALUE_LIMIT = 900_000; // stay well under typical KV payload limits

function readMemory(key) {
  const entry = memory.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeMemory(key, value, ttlMs) {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearMemoryCache() {
  memory.clear();
}

export async function withCache(key, ttlSeconds, producer) {
  if (!ttlSeconds || ttlSeconds <= 0) {
    return producer();
  }

  const memoryHit = readMemory(key);
  if (memoryHit !== undefined) {
    return memoryHit;
  }

  if (isPersistenceEnabled()) {
    try {
      const raw = await storeGet(`cache:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        writeMemory(key, parsed, ttlSeconds * 1000);
        return parsed;
      }
    } catch (error) {
      console.error("Cache read failed", error);
    }
  }

  const value = await producer();
  writeMemory(key, value, ttlSeconds * 1000);

  if (isPersistenceEnabled()) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length <= REDIS_VALUE_LIMIT) {
        storeSet(`cache:${key}`, serialized, ttlSeconds);
      }
    } catch (error) {
      console.error("Cache write failed", error);
    }
  }

  return value;
}
