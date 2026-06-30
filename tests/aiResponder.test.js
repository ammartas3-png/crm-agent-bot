import test from "node:test";
import assert from "node:assert/strict";

import { generateAiReply, aiConfigured } from "../lib/aiResponder.js";

const baseContext = {
  ok: true,
  outOfScope: false,
  draftAnswer: "Ali: 10 leads, 2 FTD, CR 20%.",
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "Ali nasıl?\n\nFACTS: {}" },
  ],
};

test("out-of-scope context returns the refusal and never calls the LLM", async () => {
  let called = false;
  const reply = await generateAiReply(
    { ok: true, outOfScope: true, refusal: "Yalnızca rapor soruları." },
    { env: { OPENAI_API_KEY: "x" }, fetchImpl: () => { called = true; } },
  );
  assert.equal(reply, "Yalnızca rapor soruları.");
  assert.equal(called, false);
});

test("falls back to draftAnswer when no LLM is configured", async () => {
  const reply = await generateAiReply(baseContext, { env: {}, fetchImpl: undefined });
  assert.equal(reply, baseContext.draftAnswer);
});

test("calls OpenAI and returns its content when OPENAI_API_KEY is set", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Ali Almanya'da güçlü." } }] }),
    };
  };
  const reply = await generateAiReply(baseContext, {
    env: { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-4o-mini" },
    fetchImpl,
  });
  assert.equal(reply, "Ali Almanya'da güçlü.");
  assert.ok(calls[0].url.includes("/chat/completions"));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.messages.length, 2);
});

test("prefers the n8n relay when AI_N8N_WEBHOOK_URL is set", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("n8n.example")) {
      return { ok: true, json: async () => ({ text: "Relay cevabı." }) };
    }
    throw new Error("OpenAI should not be called when relay succeeds");
  };
  const reply = await generateAiReply(baseContext, {
    env: { AI_N8N_WEBHOOK_URL: "https://n8n.example/webhook/ai", OPENAI_API_KEY: "sk-test" },
    fetchImpl,
  });
  assert.equal(reply, "Relay cevabı.");
});

test("falls back to draftAnswer when the LLM call fails", async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const reply = await generateAiReply(baseContext, { env: { OPENAI_API_KEY: "sk-test" }, fetchImpl });
  assert.equal(reply, baseContext.draftAnswer);
});

test("aiConfigured reflects env", () => {
  assert.equal(aiConfigured({}), false);
  assert.equal(aiConfigured({ OPENAI_API_KEY: "x" }), true);
  assert.equal(aiConfigured({ AI_N8N_WEBHOOK_URL: "https://x" }), true);
});
