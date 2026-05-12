import { NextResponse } from "next/server";

import {
  isAdminTelegramUser,
  isAllowedTelegramUser,
  UNAUTHORIZED_MESSAGE,
} from "../../../lib/permissions.js";
import {
  approveAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  notifyAdminsForAccessRequest,
  registerAdminChat,
} from "../../../lib/accessRequests.js";
import { handleMenuCallback, handleMenuText, isGreeting, startMenu } from "../../../lib/menu.js";
import {
  answerCallbackQuery,
  buildWebhookSendMessage,
  extractCallbackQuery,
  extractTelegramMessage,
  getMessageText,
  getTelegramUser,
  getTelegramUserId,
  hasTelegramBotToken,
  sendTelegramMessage,
} from "../../../lib/telegram.js";
import { answerQuery } from "../../../lib/queryRouter.js";
import { checkSheetsConnection, formatSheetsDiagnostic, safeError } from "../../../lib/diagnostics.js";
import { getGoogleCredentialConfig } from "../../../lib/googleSheets.js";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("check") === "sheets") {
    return NextResponse.json(await checkSheetsConnection());
  }
  const credentialConfig = getGoogleCredentialConfig();

  return NextResponse.json({
    ok: true,
    service: "telegram-reporting-bot",
    env: {
      telegramBotTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      googleServiceAccountEmailConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      googlePrivateKeyConfigured: Boolean(credentialConfig.privateKey),
      googlePrivateKeySource: credentialConfig.privateKeySource || "",
      googleSpreadsheetIdConfigured: Boolean(process.env.GOOGLE_SPREADSHEET_ID),
      allowedUsersConfigured: Boolean(process.env.ALLOWED_USERS),
      adminUsersConfigured: Boolean(process.env.ADMIN_USERS),
      adminChatIdsConfigured: Boolean(process.env.ADMIN_CHAT_IDS),
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
    registerAdminChat(telegramUser, chatId);

    if (callbackQuery?.data?.startsWith("access:")) {
      if (hasTelegramBotToken()) {
        await answerCallbackQuery(callbackQuery.id).catch((error) => {
          console.error("Telegram callback acknowledgement failed", error);
        });
      }

      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can approve access requests.");
      }

      const [, decision, requestId] = callbackQuery.data.split(":");
      const request =
        decision === "approve" ? approveAccessRequest(requestId) : denyAccessRequest(requestId);
      if (!request) {
        return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
      }

      const approved = decision === "approve";
      if (hasTelegramBotToken()) {
        await sendTelegramMessage(
          request.chatId,
          approved
            ? "Your access request was approved. You can now use the bot."
            : "Your access request was denied.",
        ).catch((error) => {
          console.error("Could not notify access requester", error);
        });
      }

      return sendMessageWebhookResponse(
        chatId,
        `${approved ? "Approved" : "Denied"} access for ${request.user?.username ? `@${request.user.username}` : request.user?.id}.`,
      );
    }

    if (!isAllowedTelegramUser(telegramUser || userId)) {
      const accessRequest = createAccessRequest(telegramUser, chatId, text);
      let notified = false;
      try {
        const result = hasTelegramBotToken()
          ? await notifyAdminsForAccessRequest(accessRequest)
          : { sent: 0, reason: "missing_telegram_bot_token" };
        notified = result.sent > 0;
      } catch (error) {
        console.error("Could not notify admins for access request", error);
      }

      return sendMessageWebhookResponse(
        chatId,
        notified
          ? "You are not authorized yet. An access request was sent to the admin."
          : `${UNAUTHORIZED_MESSAGE} Ask an admin to open the bot first or configure ADMIN_CHAT_IDS.`,
      );
    }

    if (isAdminTelegramUser(telegramUser) && /^\/?(debug|diagnostics?|sheets)$/i.test(text)) {
      const diagnostic = await checkSheetsConnection();
      return sendMessageWebhookResponse(chatId, formatSheetsDiagnostic(diagnostic));
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

    const menuTextResponse = await handleMenuText(userId, text);
    if (menuTextResponse) {
      return sendMessageWebhookResponse(
        chatId,
        menuTextResponse.text,
        menuTextResponse.replyMarkup,
      );
    }

    if (isGreeting(text)) {
      const response = await startMenu(userId);
      return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
    }

    const answer = await answerQuery(text);
    return sendMessageWebhookResponse(chatId, answer);
  } catch (error) {
    console.error("Telegram webhook failed", error);
    const safe = safeError(error);

    return sendMessageWebhookResponse(
      chatId,
      isAdminTelegramUser(telegramUser)
        ? `Report failed.\n${safe.message}\n\nSend /debug for a Sheets diagnostic.`
        : "Sorry, I could not calculate that report right now. Please try again later.",
    );
  }
}
