import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  aiReplyCacheKey,
  getCachedReply,
  setCachedReply,
  resetAiReplyCache,
} from "../lib/aiReplyCache.js";

beforeEach(() => resetAiReplyCache());

const context = {
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "Ali?\n\nFACTS: {}" },
  ],
  language: "tr",
  facts: { agent: "Ali" },
};

test("identical grounded context yields the same key regardless of key order", () => {
  const a = aiReplyCacheKey(context);
  const b = aiReplyCacheKey({
    facts: { agent: "Ali" },
    language: "tr",
    messages: [
      { content: "system", role: "system" },
      { content: "Ali?\n\nFACTS: {}", role: "user" },
    ],
  });
  assert.equal(a, b);
});

test("different facts produce a different key (fresh answer on data change)", () => {
  const a = aiReplyCacheKey(context);
  const b = aiReplyCacheKey({ ...context, facts: { agent: "Veli" } });
  assert.notEqual(a, b);
});

test("stores and returns a value within TTL", () => {
  const key = aiReplyCacheKey(context);
  setCachedReply(key, "hello", { env: {}, now: 1000 });
  assert.equal(getCachedReply(key, { env: {}, now: 2000 }), "hello");
});

test("expires entries past the TTL", () => {
  const key = aiReplyCacheKey(context);
  setCachedReply(key, "hello", { env: { AI_REPLY_CACHE_TTL_MS: "1000" }, now: 0 });
  assert.equal(getCachedReply(key, { env: { AI_REPLY_CACHE_TTL_MS: "1000" }, now: 500 }), "hello");
  assert.equal(getCachedReply(key, { env: { AI_REPLY_CACHE_TTL_MS: "1000" }, now: 1500 }), null);
});

test("TTL=0 disables caching", () => {
  const key = aiReplyCacheKey(context);
  setCachedReply(key, "hello", { env: { AI_REPLY_CACHE_TTL_MS: "0" }, now: 0 });
  assert.equal(getCachedReply(key, { env: { AI_REPLY_CACHE_TTL_MS: "0" }, now: 1 }), null);
});

test("does not store empty replies", () => {
  const key = aiReplyCacheKey(context);
  setCachedReply(key, "   ", { env: {}, now: 0 });
  assert.equal(getCachedReply(key, { env: {}, now: 1 }), null);
});
