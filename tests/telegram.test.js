import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSendMessagePayload,
  buildWebhookEditMessage,
  buildWebhookSendMessage,
  sanitizeTelegramCaption,
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

test("buildWebhookEditMessage returns editMessageText payload", () => {
  const payload = buildWebhookEditMessage(123, 456, "Updated", {
    replyMarkup: { inline_keyboard: [[{ text: "Done", callback_data: "done" }]] },
  });
  assert.equal(payload.method, "editMessageText");
  assert.equal(payload.chat_id, 123);
  assert.equal(payload.message_id, 456);
  assert.equal(payload.text, "Updated");
  assert.equal(payload.reply_markup.inline_keyboard[0][0].text, "Done");
});

test("sanitizeTelegramCaption keeps short captions unchanged", () => {
  const caption = "Short caption";
  assert.equal(sanitizeTelegramCaption(caption), caption);
});

test("sanitizeTelegramCaption truncates long captions safely", () => {
  const caption = "A".repeat(1100);
  const result = sanitizeTelegramCaption(caption);
  assert.equal(result.length <= 1024, true);
  assert.equal(result.endsWith("..."), true);
});
