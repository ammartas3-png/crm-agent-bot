export const START_MESSAGE = [
  "CRM Reporting Bot is ready.",
  "",
  "Ask questions like:",
  "- How many FTD today?",
  "- Germany total leads?",
  "- Ahmet total calls?",
  "- May Turkey leads count?",
  "",
  "Data access is limited to authorized Telegram users.",
].join("\n");

export function extractTelegramMessage(update) {
  if (!update || typeof update !== "object") {
    return null;
  }

  return (
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null
  );
}

export function extractCallbackQuery(update) {
  return update?.callback_query || null;
}

export function getMessageText(message) {
  return String(message?.text || "").trim();
}

export function getTelegramUserId(message) {
  return message?.from?.id ?? null;
}

export async function callTelegramApi(method, payload, options = {}) {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok || responsePayload.ok === false) {
    const description = responsePayload.description || response.statusText;
    throw new Error(`Telegram ${method} failed: ${description}`);
  }

  return responsePayload;
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  return callTelegramApi(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    },
    options,
  );
}

export async function answerCallbackQuery(callbackQueryId, options = {}) {
  return callTelegramApi(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      ...(options.text ? { text: options.text } : {}),
    },
    options,
  );
}
