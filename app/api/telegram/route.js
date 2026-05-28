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
  buildWebhookEditMessage,
  buildWebhookSendMessage,
  extractCallbackQuery,
  fetchTelegramFileBuffer,
  extractTelegramMessage,
  getMessageText,
  getTelegramUser,
  getTelegramUserId,
  hasTelegramBotToken,
  sendTelegramDocument,
  sendTelegramMessage,
} from "../../../lib/telegram.js";
import { answerQuery } from "../../../lib/queryRouter.js";
import { checkSheetsConnection, formatSheetsDiagnostic, safeError } from "../../../lib/diagnostics.js";
import { getGoogleCredentialConfig } from "../../../lib/googleSheets.js";
import { getMonthFile, listMonthFiles } from "../../../lib/monthlyReports.js";
import { buildDebugTotalsReport, formatDebugTotalsReport } from "../../../lib/reconciliation.js";
import {
  ROOT_START_TEXT,
  databaseCheckMenuKeyboard,
  formatDatabaseCheckSummary,
  handleDatabaseCheckCallback,
  handleDatabaseCheckText,
  processDatabaseCheckWorkbook,
  rootStartKeyboard,
} from "../../../lib/databaseCheck.js";
import { getSession, setSession } from "../../../lib/session.js";
import { buildHelpText, isHelpCommand } from "../../../lib/help.js";

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

function editMessageWebhookResponse(chatId, messageId, text, replyMarkup) {
  return NextResponse.json(buildWebhookEditMessage(chatId, messageId, text, { replyMarkup }));
}

function isStartCommand(text) {
  return /^\/?start(?:@\w+)?(?:\s+.*)?$/i.test(String(text || "").trim());
}

function debugTotalsMonthKeyboard() {
  const months = listMonthFiles({ includeInactive: true });
  if (!months.length) {
    return null;
  }
  return {
    inline_keyboard: months.map((month) => [
      {
        text: `${month.month_label}${month.active ? "" : " (Inactive)"}`,
        callback_data: `debugTotals:${month.key}`,
      },
    ]),
  };
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
  const document = message?.document || null;

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

    if (/^\/?debug_totals\b/i.test(text)) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can run /debug_totals.");
      }
      const keyboard = debugTotalsMonthKeyboard();
      if (!keyboard) {
        return sendMessageWebhookResponse(chatId, "No month files configured for debug validation.");
      }
      return sendMessageWebhookResponse(chatId, "Select month for reconciliation validation:", keyboard);
    }

    if (!callbackQuery && isStartCommand(text)) {
      setSession(userId, { step: null, dbCheckStep: null, view: null });
      return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
    }

    if (!callbackQuery && isHelpCommand(text)) {
      return sendMessageWebhookResponse(chatId, buildHelpText(telegramUser));
    }

    if (callbackQuery) {
      if (hasTelegramBotToken()) {
        await answerCallbackQuery(callbackQuery.id).catch((error) => {
          console.error("Telegram callback acknowledgement failed", error);
        });
      }

      if (callbackQuery.data?.startsWith("debugTotals:")) {
        if (!isAdminTelegramUser(telegramUser)) {
          return sendMessageWebhookResponse(chatId, "Only admins can run /debug_totals.");
        }
        const monthKey = callbackQuery.data.split(":")[1];
        const month = getMonthFile(monthKey, { includeInactive: true });
        if (!month) {
          return sendMessageWebhookResponse(
            chatId,
            "Month mapping not found. Run /debug_totals again.",
            debugTotalsMonthKeyboard(),
          );
        }
        const report = await buildDebugTotalsReport({
          context: {
            monthKey: month.key,
            monthLabel: month.month_label,
            spreadsheetId: month.sheet_id,
          },
        });
        return sendMessageWebhookResponse(chatId, formatDebugTotalsReport(report), debugTotalsMonthKeyboard());
      }

      if (callbackQuery.data === "root:start") {
        return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
      }
      if (callbackQuery.data === "root:results") {
        const response = await startMenu(userId, { telegramUser });
        return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
      }

      if (callbackQuery.data?.startsWith("dbcheck:")) {
        const dbResponse = await handleDatabaseCheckCallback(userId, callbackQuery.data, {
          isAdmin: isAdminTelegramUser(telegramUser),
          telegramUser,
        });
        if (dbResponse) {
          return sendMessageWebhookResponse(chatId, dbResponse.text, dbResponse.replyMarkup);
        }
      }

      const response = await handleMenuCallback(userId, callbackQuery.data, { telegramUser });
      if (response?.documentBuffer) {
        if (!hasTelegramBotToken()) {
          return sendMessageWebhookResponse(
            chatId,
            "TELEGRAM_BOT_TOKEN is required to send Excel export files.",
            response.replyMarkup,
          );
        }
        await sendTelegramDocument(
          chatId,
          response.documentBuffer,
          response.documentFilename || "report.xlsx",
          { caption: response.documentCaption || "CRM report export" },
        );
        if (response.suppressTextResponse) {
          return NextResponse.json({ ok: true, sentDocument: true });
        }
      }
      if (response?.editCurrentMessage && callbackQuery.message?.message_id) {
        return editMessageWebhookResponse(
          chatId,
          callbackQuery.message.message_id,
          response.text,
          response.replyMarkup,
        );
      }
      return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
    }

    if (document) {
      const fileName = String(document.file_name || "").toLocaleLowerCase("en-US");
      const mimeType = String(document.mime_type || "").toLocaleLowerCase("en-US");
      if (!/\.xlsx?$/.test(fileName) && !mimeType.includes("spreadsheet") && !mimeType.includes("excel")) {
        return sendMessageWebhookResponse(
          chatId,
          "Unsupported file type. Please upload .xlsx or .xls file.",
          databaseCheckMenuKeyboard(isAdminTelegramUser(telegramUser)),
        );
      }
      const session = getSession(userId);
      if (session.dbCheckStep !== "await_file") {
        return sendMessageWebhookResponse(
          chatId,
          "Open Database Check and choose Upload CRM Excel first.",
          databaseCheckMenuKeyboard(isAdminTelegramUser(telegramUser)),
        );
      }
      if (!hasTelegramBotToken()) {
        return sendMessageWebhookResponse(chatId, "TELEGRAM_BOT_TOKEN is required for file download.");
      }
      const fileBuffer = await fetchTelegramFileBuffer(document.file_id);
      const review = await processDatabaseCheckWorkbook(fileBuffer);
      await sendTelegramDocument(chatId, review.outputBuffer, review.outputFilename, {
        caption: "CRM comment/status validation output",
      });
      setSession(userId, { dbCheckStep: null });
      return sendMessageWebhookResponse(
        chatId,
        formatDatabaseCheckSummary(review.summary, review.flaggedRowsCount),
        databaseCheckMenuKeyboard(isAdminTelegramUser(telegramUser)),
      );
    }

    const dbTextResponse = await handleDatabaseCheckText(userId, text, {
      isAdmin: isAdminTelegramUser(telegramUser),
    });
    if (dbTextResponse) {
      return sendMessageWebhookResponse(chatId, dbTextResponse.text, dbTextResponse.replyMarkup);
    }

    const menuTextResponse = await handleMenuText(userId, text, { telegramUser });
    if (menuTextResponse) {
      return sendMessageWebhookResponse(
        chatId,
        menuTextResponse.text,
        menuTextResponse.replyMarkup,
      );
    }

    if (isGreeting(text)) {
      return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
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
