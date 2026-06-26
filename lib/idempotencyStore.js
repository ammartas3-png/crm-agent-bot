const store = new Map();
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 500;

function ttlMs() {
  if (Number.isFinite(Number(process.env.IDEMPOTENCY_TTL_MS))) {
    return Math.max(60 * 1000, Number(process.env.IDEMPOTENCY_TTL_MS));
  }
  return DEFAULT_TTL_MS;
}

function prune() {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - Number(value.ts || 0) > ttlMs()) {
      store.delete(key);
    }
  }
  if (store.size <= MAX_ITEMS) {
    return;
  }
  const sorted = [...store.entries()].sort((left, right) => Number(left[1]?.ts || 0) - Number(right[1]?.ts || 0));
  while (store.size > MAX_ITEMS && sorted.length) {
    const [oldestKey] = sorted.shift();
    store.delete(oldestKey);
  }
}

export function getIdempotentResult(key = "") {
  prune();
  const item = store.get(String(key || ""));
  if (!item) {
    return null;
  }
  return item.payload;
}

export function setIdempotentResult(key = "", payload = null) {
  const normalized = String(key || "").trim();
  if (!normalized || !payload) {
    return;
  }
  store.set(normalized, { ts: Date.now(), payload });
  prune();
}

export function clearIdempotencyStore() {
  store.clear();
}
