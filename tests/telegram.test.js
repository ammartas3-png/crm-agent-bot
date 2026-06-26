import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSendMessagePayload,
  buildWebhookSendMessage,
  isValidWebhookRequest,
  isValidWebhookSecret,
} from "../lib/telegram.js";

test("buildSendMessagePayload includes inline reply markup", () => {
  const payload = buildSendMessagePayload(123, "Hello", {
    replyMarkup: { inline_keyboard: [[{ text: "Menu", callback_data: "menu:main" }]] },
  });

  assert.equal(payload.chat_id, 123);
  assert.equal(payload.text, "Hello");
  assert.equal(payload.reply_markup.inline_keyboard[0][0].text, "Menu");
});

test("buildWebhookSendMessage returns Telegram webhook method payload", () => {
  const payload = buildWebhookSendMessage(123, "Menu");

  assert.equal(payload.method, "sendMessage");
  assert.equal(payload.chat_id, 123);
  assert.equal(payload.text, "Menu");
});

test("isValidWebhookSecret accepts any request when no secret is configured", () => {
  assert.equal(isValidWebhookSecret(undefined, {}), true);
  assert.equal(isValidWebhookSecret("anything", { TELEGRAM_WEBHOOK_SECRET: "" }), true);
});

test("isValidWebhookSecret enforces an exact match when configured", () => {
  const env = { TELEGRAM_WEBHOOK_SECRET: "s3cr3t" };
  assert.equal(isValidWebhookSecret("s3cr3t", env), true);
  assert.equal(isValidWebhookSecret("wrong", env), false);
  assert.equal(isValidWebhookSecret(undefined, env), false);
});

test("isValidWebhookRequest reads the Telegram secret header", () => {
  const env = { TELEGRAM_WEBHOOK_SECRET: "s3cr3t" };
  const makeRequest = (value) => ({
    headers: { get: (name) => (name === "x-telegram-bot-api-secret-token" ? value : null) },
  });

  assert.equal(isValidWebhookRequest(makeRequest("s3cr3t"), env), true);
  assert.equal(isValidWebhookRequest(makeRequest("nope"), env), false);
  assert.equal(isValidWebhookRequest(makeRequest(null), { TELEGRAM_WEBHOOK_SECRET: "" }), true);
});
