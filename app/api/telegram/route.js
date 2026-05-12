import { NextResponse } from "next/server";

import { isAllowedTelegramUser, UNAUTHORIZED_MESSAGE } from "../../../lib/permissions.js";
import { handleMenuCallback, isGreeting, startMenu } from "../../../lib/menu.js";
import {
  answerCallbackQuery,
  buildWebhookSendMessage,
  extractCallbackQuery,
  extractTelegramMessage,
  getMessageText,
  getTelegramUser,
  getTelegramUserId,
  hasTelegramBotToken,
} from "../../../lib/telegram.js";
import { answerQuery } from "../../../lib/queryRouter.js";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telegram-reporting-bot",
    env: {
      telegramBotTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      googleServiceAccountEmailConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      googlePrivateKeyConfigured: Boolean(process.env.GOOGLE_PRIVATE_KEY),
      googleSpreadsheetIdConfigured: Boolean(process.env.GOOGLE_SPREADSHEET_ID),
      allowedUsersConfigured: Boolean(process.env.ALLOWED_USERS),
      adminUsersConfigured: Boolean(process.env.ADMIN_USERS),
    },
  });
}

function sendMessageWebhookResponse(chatId, text, replyMarkup) {
  return NextResponse.json(buildWebhookSendMessage(chatId, text, { replyMarkup }));
}

export async function POST(request) {
  let update;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const callbackQuery = extractCallbackQuery(update);
  const message = callbackQuery?.message || extractTelegramMessage(update);
  if (!message?.chat?.id) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const chatId = message.chat.id;
  const telegramUser = callbackQuery?.from ?? getTelegramUser(message);
  const userId = telegramUser?.id ?? getTelegramUserId(message);
  const text = getMessageText(message);

  try {
    if (!isAllowedTelegramUser(telegramUser || userId)) {
      return sendMessageWebhookResponse(chatId, UNAUTHORIZED_MESSAGE);
    }

    if (callbackQuery) {
      if (hasTelegramBotToken()) {
        await answerCallbackQuery(callbackQuery.id).catch((error) => {
          console.error("Telegram callback acknowledgement failed", error);
        });
      }
      const response = await handleMenuCallback(userId, callbackQuery.data);
      return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
    }

    if (isGreeting(text)) {
      const response = await startMenu(userId);
      return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
    }

    const answer = await answerQuery(text);
    return sendMessageWebhookResponse(chatId, answer);
  } catch (error) {
    console.error("Telegram webhook failed", error);

    return sendMessageWebhookResponse(
      chatId,
      "Sorry, I could not calculate that report right now. Please try again later.",
    );
  }
}
