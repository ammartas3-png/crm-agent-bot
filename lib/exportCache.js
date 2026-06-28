import { isPersistenceEnabled, storeGet, storeSet } from "./store.js";

// Two-tier TTL cache for generated bot Excel exports. The same office + month +
// report (+ scope) produces an identical workbook, so under concurrent load we
// build it once and reuse it instead of re-reading the sheet and rebuilding the
// xlsx. A fast per-instance memory tier plus an optional Redis/KV tier (for
// small workbooks) shares results across serverless instances and cold starts.

const cache = new Map();
const MAX_ENTRIES = 200;
const KV_PREFIX = "crm:export:";
const KV_VALUE_LIMIT = 900_000; // base64 chars; skip KV for larger workbooks

function ttlMs(env = process.env) {
  const raw = Number(env.EXPORT_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return 120_000;
}

export function clearExportCache() {
  cache.clear();
}

// Export payloads carry a Buffer (workbookBuffer); serialize it as base64 for KV.
function serialize(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return JSON.stringify({
    fileName: value.fileName ?? null,
    caption: value.caption ?? null,
    workbookBuffer: Buffer.isBuffer(value.workbookBuffer)
      ? value.workbookBuffer.toString("base64")
      : null,
  });
}

function deserialize(raw) {
  const parsed = JSON.parse(raw);
  return {
    fileName: parsed.fileName ?? undefined,
    caption: parsed.caption ?? undefined,
    workbookBuffer: parsed.workbookBuffer ? Buffer.from(parsed.workbookBuffer, "base64") : null,
  };
}

function writeMemory(key, value, ttl) {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export async function getOrBuildExport(key, builder) {
  const ttl = ttlMs();
  if (ttl > 0) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    if (isPersistenceEnabled()) {
      try {
        const raw = await storeGet(`${KV_PREFIX}${key}`);
        if (raw) {
          const value = deserialize(raw);
          writeMemory(key, value, ttl);
          return value;
        }
      } catch (error) {
        console.error("Export cache KV read failed", error);
      }
    }
  }

  const value = await builder();

  if (ttl > 0) {
    writeMemory(key, value, ttl);
    if (isPersistenceEnabled()) {
      try {
        const serialized = serialize(value);
        if (serialized && serialized.length <= KV_VALUE_LIMIT) {
          storeSet(`${KV_PREFIX}${key}`, serialized, Math.ceil(ttl / 1000));
        }
      } catch (error) {
        console.error("Export cache KV write failed", error);
      }
    }
  }
  return value;
}
