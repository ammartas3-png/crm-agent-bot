// Small in-memory, TTL-bounded cache for final AI replies.
//
// Identical *grounded* prompts (same messages + language + facts) map to the
// same key, so repeated questions are answered without spending any LLM tokens.
// This is the exact-match equivalent of a semantic cache (e.g. GPTCache) with
// zero external dependencies and a graceful miss path: on any miss/error the
// caller still performs the live LLM call, so correctness never regresses.
//
// Because the cache key includes the grounded FACTS, a data change produces a
// different key (fresh answer) rather than a stale hit — staleness is bounded by
// the facts, not just the clock.
//
// Tuning: AI_REPLY_CACHE_TTL_MS (ms). 0 disables the cache. Default 10 minutes.

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

const store = new Map(); // key -> { text, expiresAt }

function ttlFromEnv(env) {
  const raw = env?.AI_REPLY_CACHE_TTL_MS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_TTL_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TTL_MS;
  }
  return parsed;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

// Key is derived only from what determines the LLM output.
export function aiReplyCacheKey(context = {}) {
  return stableStringify({
    messages: Array.isArray(context.messages) ? context.messages : [],
    language: context.language || "",
    facts: context.facts ?? null,
  });
}

function pruneExpired(now) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function getCachedReply(key, { env = process.env, now = Date.now() } = {}) {
  if (!key || ttlFromEnv(env) <= 0) {
    return null;
  }
  const entry = store.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  // Refresh recency (move to newest) so eviction is roughly LRU.
  store.delete(key);
  store.set(key, entry);
  return entry.text;
}

export function setCachedReply(key, text, { env = process.env, now = Date.now() } = {}) {
  const ttl = ttlFromEnv(env);
  if (!key || ttl <= 0 || typeof text !== "string" || !text.trim()) {
    return;
  }
  pruneExpired(now);
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) {
      store.delete(oldest);
    }
  }
  store.set(key, { text, expiresAt: now + ttl });
}

// Test helper: clears shared state between cases.
export function resetAiReplyCache() {
  store.clear();
}
