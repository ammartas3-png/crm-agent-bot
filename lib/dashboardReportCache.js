function stableStringify(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function cloneSerializable(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function reportCacheKey(accessContext = {}, query = {}) {
  const authorityScope = accessContext?.authorityScope || {};
  const telegramUser = accessContext?.telegramUser || {};
  return stableStringify({
    permissionFilters: accessContext?.permissionFilters || {},
    authorityScope: {
      allowed: Boolean(authorityScope?.allowed),
      unrestricted: Boolean(authorityScope?.unrestricted),
      filters: authorityScope?.filters || {},
    },
    telegramUser: {
      id: Number(telegramUser?.id || 0),
      username: String(telegramUser?.username || "").trim().toLowerCase(),
    },
    query: query || {},
  });
}

export function createDashboardReportCache({
  ttlMs = 45 * 1000,
  maxEntries = 180,
} = {}) {
  const normalizedTtl = Math.max(0, Number(ttlMs || 0));
  const normalizedMax = Math.max(10, Number(maxEntries || 10));
  let cache = new Map();

  function prune() {
    if (cache.size <= normalizedMax) {
      return;
    }
    const sorted = [...cache.entries()].sort((left, right) => Number(left[1]?.ts || 0) - Number(right[1]?.ts || 0));
    while (cache.size > normalizedMax && sorted.length) {
      const [cacheKey] = sorted.shift();
      cache.delete(cacheKey);
    }
  }

  return {
    key(accessContext = {}, query = {}) {
      return reportCacheKey(accessContext, query);
    },
    get(cacheKey = "") {
      const cached = cache.get(cacheKey);
      if (!cached) {
        return null;
      }
      if (Date.now() - Number(cached.ts || 0) > normalizedTtl) {
        cache.delete(cacheKey);
        return null;
      }
      return cloneSerializable(cached.value);
    },
    set(cacheKey = "", value = null) {
      if (!cacheKey || !value) {
        return;
      }
      cache.set(cacheKey, { ts: Date.now(), value: cloneSerializable(value) });
      prune();
    },
    clear() {
      cache.clear();
    },
  };
}
