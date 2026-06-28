// In-memory TTL cache for generated bot Excel exports. The same office + month +
// report produces an identical workbook for full-authority users, so under
// concurrent load we build it once and reuse it instead of re-reading the sheet
// and rebuilding the workbook for every request.

const cache = new Map();
const MAX_ENTRIES = 200;

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

export async function getOrBuildExport(key, builder) {
  const ttl = ttlMs();
  if (ttl > 0) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
  }

  const value = await builder();

  if (ttl > 0) {
    if (cache.size >= MAX_ENTRIES) {
      // Simple bound: drop the oldest entry.
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(key, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}
