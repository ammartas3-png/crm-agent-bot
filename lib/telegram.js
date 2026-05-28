export const START_MESSAGE = [
  "CRM Reporting Bot is ready.",
  "",
  "Ask questions like:",
  "- How many FTD today?",
  "- How many FTD yesterday?",
  "- Germany total leads?",
  "- Uganda total FTD?",
  "- Ahmet total calls?",
  "- Ahmet FTD last 3 months?",
  "- Leader 1 leads last 4 months?",
  "- Istanbul desk yesterday leads?",
  "- May Turkey leads count?",
  "",
  "Tip: Use /hello for guided Q&A flow.",
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

export function getTelegramUser(message) {
  return message?.from || null;
}

export function hasTelegramBotToken() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function buildSendMessagePayload(chatId, text, options = {}) {
  return {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  };
}

export function buildWebhookSendMessage(chatId, text, options = {}) {
  return {
    method: "sendMessage",
    ...buildSendMessagePayload(chatId, text, options),
  };
}

export function buildWebhookEditMessage(chatId, messageId, text, options = {}) {
  return {
    method: "editMessageText",
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  };
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
    buildSendMessagePayload(chatId, text, options),
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

export async function fetchTelegramFileBuffer(fileId, options = {}) {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  const fileResult = await callTelegramApi("getFile", { file_id: fileId }, options);
  const filePath = fileResult?.result?.file_path;
  if (!filePath) {
    throw new Error("Could not resolve Telegram file path.");
  }
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new Error(`Could not download Telegram file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function sendTelegramDocument(chatId, fileBuffer, fileName, options = {}) {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  if (options.caption) {
    formData.append("caption", String(options.caption));
  }
  const blob = new Blob([fileBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  formData.append("document", blob, fileName || "report.xlsx");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Telegram sendDocument failed: ${payload.description || response.statusText}`);
  }
  return payload;
}
