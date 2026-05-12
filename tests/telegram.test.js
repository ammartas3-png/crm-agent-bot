import assert from "node:assert/strict";
import test from "node:test";

import { buildSendMessagePayload, buildWebhookSendMessage } from "../lib/telegram.js";

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
