import assert from "node:assert/strict";
import test from "node:test";

import {
  flushPersistence,
  isPersistenceEnabled,
  storeGet,
  storeSetAdd,
  storeSetMembers,
} from "../lib/store.js";

test("isPersistenceEnabled reflects KV configuration", () => {
  assert.equal(isPersistenceEnabled({}), false);
  assert.equal(isPersistenceEnabled({ KV_REST_API_URL: "https://x" }), false);
  assert.equal(
    isPersistenceEnabled({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }),
    true,
  );
  assert.equal(
    isPersistenceEnabled({
      UPSTASH_REDIS_REST_URL: "https://x",
      UPSTASH_REDIS_REST_TOKEN: "t",
    }),
    true,
  );
});

test("store operations are safe no-ops when unconfigured", async () => {
  assert.equal(await storeGet("crm:test"), null);
  assert.deepEqual(await storeSetMembers("crm:test"), []);
  await assert.doesNotReject(storeSetAdd("crm:test", "1"));
  await assert.doesNotReject(flushPersistence());
});

test("write-through mirrors to KV and reads members back", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.Authorization, body });
    if (body[0] === "SMEMBERS") {
      return { ok: true, json: async () => ({ result: ["123", "456"] }) };
    }
    return { ok: true, json: async () => ({ result: 1 }) };
  };

  try {
    storeSetAdd("crm:approved_users", "123");
    await flushPersistence();

    const members = await storeSetMembers("crm:approved_users");
    assert.deepEqual(members, ["123", "456"]);

    assert.equal(calls[0].url, "https://example.upstash.io");
    assert.equal(calls[0].auth, "Bearer token");
    assert.deepEqual(calls[0].body, ["SADD", "crm:approved_users", "123"]);
    assert.deepEqual(calls[1].body, ["SMEMBERS", "crm:approved_users"]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
});
