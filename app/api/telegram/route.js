import { NextResponse } from "next/server";

import {
  approveTelegramUser,
  denyTelegramUser,
  isAdminTelegramUser,
  isAllowedTelegramUser,
  listRuntimeApprovals,
  normalizePrincipal,
  parseAllowedUsers,
  parseAdminUsers,
  telegramUserPrincipals,
  UNAUTHORIZED_MESSAGE,
} from "../../../lib/permissions.js";
import {
  accessRequestMessage,
  approveAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  getAccessRequest,
  listPendingAccessRequests,
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
import {
  answerQuery,
  answerQueryDetailed,
  HELLO_MESSAGE,
  isHelloCommand,
  shouldAskScopeFollowUp,
} from "../../../lib/queryRouter.js";
import { checkSheetsConnection, formatSheetsDiagnostic, safeError } from "../../../lib/diagnostics.js";
import { filteredRows, getFieldName, getRowValue } from "../../../lib/calculations.js";
import { getGoogleCredentialConfig, readSheetRows } from "../../../lib/googleSheets.js";
import { resolveAuthorityScopeForUser } from "../../../lib/authorityScope.js";
import { getMonthFile, listMonthFiles } from "../../../lib/monthlyReports.js";
import { buildDebugTotalsReport, formatDebugTotalsReport } from "../../../lib/reconciliation.js";
import { getTabConfig } from "../../../config/sheetsConfig.js";
import {
  authorityRowDisplayLabel,
  readAuthorityRows,
  removeAuthorityRowByNumber,
  removeAuthorityUserByPrincipal,
  upsertAuthorityUserScope,
} from "../../../lib/authoritySheetService.js";
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

function scopeFiltersFromAuthority(authorityScope = {}) {
  const filters = authorityScope?.filters || {};
  return Object.keys(filters).length ? filters : {};
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildAccessScopeContext(rows = [], tabConfig) {
  const officeField = getFieldName(tabConfig, "office");
  const deskField = getFieldName(tabConfig, "department");
  const teamField = getFieldName(tabConfig, "teamLeader");
  const triples = [];
  const seen = new Set();
  for (const row of rows) {
    const office = String(getRowValue(row, officeField) || "").trim();
    const desk = String(getRowValue(row, deskField) || "").trim();
    const teamLeader = String(getRowValue(row, teamField) || "").trim();
    const key = `${office.toLocaleLowerCase("en-US")}::${desk.toLocaleLowerCase("en-US")}::${teamLeader.toLocaleLowerCase(
      "en-US",
    )}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    triples.push({ office, desk, teamLeader });
  }
  return {
    triples,
    offices: uniqueSorted(triples.map((item) => item.office)),
  };
}

function valuesForScopeStage(draft = {}, stage = "office") {
  const triples = draft.scopeTriples || [];
  const selectedOffices = new Set(draft.selectedOffices || []);
  const selectedDesks = new Set(draft.selectedDesks || []);
  if (stage === "office") {
    return uniqueSorted(draft.officeOptions || []);
  }
  if (stage === "desk") {
    const filtered = selectedOffices.size
      ? triples.filter((item) => selectedOffices.has(item.office))
      : triples;
    return uniqueSorted(filtered.map((item) => item.desk));
  }
  const filteredByOffice = selectedOffices.size
    ? triples.filter((item) => selectedOffices.has(item.office))
    : triples;
  const filteredByDesk = selectedDesks.size
    ? filteredByOffice.filter((item) => selectedDesks.has(item.desk))
    : filteredByOffice;
  return uniqueSorted(filteredByDesk.map((item) => item.teamLeader));
}

function selectedForScopeStage(draft = {}, stage = "office") {
  if (stage === "office") {
    return draft.selectedOffices || [];
  }
  if (stage === "desk") {
    return draft.selectedDesks || [];
  }
  return draft.selectedTeamLeaders || [];
}

function normalizeScopeSelections(draft = {}) {
  const next = { ...draft };
  const validOffices = new Set(valuesForScopeStage(next, "office"));
  next.selectedOffices = (next.selectedOffices || []).filter((value) => validOffices.has(value));
  const validDesks = new Set(valuesForScopeStage(next, "desk"));
  next.selectedDesks = (next.selectedDesks || []).filter((value) => validDesks.has(value));
  const validTeams = new Set(valuesForScopeStage(next, "teamLeader"));
  next.selectedTeamLeaders = (next.selectedTeamLeaders || []).filter((value) => validTeams.has(value));
  return next;
}

function paginateList(items = [], page = 0, pageSize = 10) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  return {
    page: safePage,
    totalPages,
    start,
    chunk: items.slice(start, start + pageSize),
  };
}

function scopeStageLabel(stage = "office") {
  if (stage === "office") {
    return "Office";
  }
  if (stage === "desk") {
    return "Desk";
  }
  return "Team Leader";
}

function scopeDraftKeyboard(draft = {}, stage = "office") {
  const allValues = valuesForScopeStage(draft, stage);
  const selected = new Set(selectedForScopeStage(draft, stage));
  const pageByStage = draft.pageByStage || {};
  const { page, totalPages, start, chunk } = paginateList(allValues, pageByStage[stage] || 0, 10);
  const rows = chunk.map((label, index) => [
    {
      text: `${selected.has(label) ? "✅" : "⬜"} ${label}`,
      callback_data: `accessScope:${draft.requestId}:toggle:${stage}:${start + index}`,
    },
  ]);
  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callback_data: `accessScope:${draft.requestId}:page:${stage}:${Math.max(page - 1, 0)}` },
      { text: "Next Page", callback_data: `accessScope:${draft.requestId}:page:${stage}:${Math.min(page + 1, totalPages - 1)}` },
    ]);
  }
  rows.push([
    { text: "All", callback_data: `accessScope:${draft.requestId}:all:${stage}` },
    { text: "Clear", callback_data: `accessScope:${draft.requestId}:clear:${stage}` },
  ]);
  rows.push([{ text: "Done", callback_data: `accessScope:${draft.requestId}:done:${stage}` }]);
  rows.push([{ text: "Cancel", callback_data: `accessScope:${draft.requestId}:cancel` }]);
  return { inline_keyboard: rows };
}

function scopeDraftPrompt(draft = {}, stage = "office") {
  const selected = selectedForScopeStage(draft, stage);
  return [
    `Grant scoped access — ${scopeStageLabel(stage)} selection`,
    `User: ${draft.targetUsername || draft.targetId || "Unknown"}`,
    `Selected ${selected.length}/${valuesForScopeStage(draft, stage).length}`,
    "Use All/Clear and Done to continue.",
  ].join("\n");
}

async function loadScopeDraftForRequest(requestId) {
  const request = getAccessRequest(requestId);
  if (!request || request.status !== "pending") {
    return null;
  }
  const month = listMonthFiles()[0] || null;
  const tabConfig = getTabConfig("leads");
  const rows = await readSheetRows("leads", {
    tabConfig,
    spreadsheetId: month?.sheet_id,
  });
  const scope = buildAccessScopeContext(rows, tabConfig);
  return {
    requestId,
    targetUser: request.user,
    targetId: request.user?.id ? String(request.user.id) : "",
    targetUsername: request.user?.username ? `@${request.user.username}` : "",
    scopeTriples: scope.triples,
    officeOptions: scope.offices,
    selectedOffices: [],
    selectedDesks: [],
    selectedTeamLeaders: [],
    pageByStage: { office: 0, desk: 0, teamLeader: 0 },
  };
}

function scopeSummaryText(draft = {}) {
  const offices = draft.selectedOffices?.length ? draft.selectedOffices.join(", ") : "all";
  const desks = draft.selectedDesks?.length ? draft.selectedDesks.join(", ") : "all";
  const teams = draft.selectedTeamLeaders?.length ? draft.selectedTeamLeaders.join(", ") : "all";
  return [`Office: ${offices}`, `Desk: ${desks}`, `Team Leader: ${teams}`].join("\n");
}

function isAuthorityUsersCommand(text) {
  return /^\/?authority_users\b/i.test(String(text || "").trim());
}

function parseAuthorityRemoveCommand(text) {
  const match = String(text || "")
    .trim()
    .match(/^\/?authority_remove\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const principal = normalizePrincipal(match[1]);
  return principal ? { principal } : null;
}

function authorityListKeyboard(rows = [], page = 0) {
  const { page: safePage, totalPages, chunk } = paginateList(rows, page, 10);
  const keyboardRows = chunk.map((row) => [
    {
      text: `❌ ${authorityRowDisplayLabel(row)}`,
      callback_data: `authority:del:${row.rowNumber}:${safePage}`,
    },
  ]);
  if (totalPages > 1) {
    keyboardRows.push([
      { text: "Previous Page", callback_data: `authority:page:${Math.max(safePage - 1, 0)}` },
      { text: "Next Page", callback_data: `authority:page:${Math.min(safePage + 1, totalPages - 1)}` },
    ]);
  }
  return { inline_keyboard: keyboardRows };
}

async function authorityListResponse(page = 0) {
  const rows = await readAuthorityRows();
  if (!rows.length) {
    return { text: "Authority table is empty.", replyMarkup: null };
  }
  const { page: safePage, totalPages, chunk, start } = paginateList(rows, page, 10);
  const text = [
    `Authority Users (Page ${safePage + 1}/${totalPages})`,
    ...chunk.map(
      (row, index) =>
        `${start + index + 1}. ${authorityRowDisplayLabel(row)}\nOffice: ${row.office || "all"} | Desk: ${
          row.desk || "all"
        } | Authority: ${row.authority || "all"}`,
    ),
  ].join("\n\n");
  return { text, replyMarkup: authorityListKeyboard(rows, safePage) };
}

function buildScopedReadRows(authorityScope = {}, now = new Date()) {
  const scopeFilters = scopeFiltersFromAuthority(authorityScope);
  return async (tabKey, options = {}) => {
    const rows = await readSheetRows(tabKey, options);
    if (tabKey !== "leads" || !Object.keys(scopeFilters).length) {
      return rows;
    }
    const tabConfig = options.tabConfig || getTabConfig("leads");
    return filteredRows(rows, tabConfig, scopeFilters, now);
  };
}

function parseAllowCommand(text) {
  const match = String(text || "")
    .trim()
    .match(/^\/?(allow|deny)\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const action = match[1].toLocaleLowerCase("en-US");
  const target = normalizePrincipal(match[2]);
  if (!target) {
    return null;
  }
  return { action, target };
}

function isWhoAmICommand(text) {
  return /^\/?(whoami|me)\b/i.test(String(text || "").trim());
}

function formatUserIdentity(telegramUser) {
  const principals = telegramUserPrincipals(telegramUser);
  return [
    `Telegram ID: ${telegramUser?.id ?? "-"}`,
    `Username: ${telegramUser?.username ? `@${telegramUser.username}` : "-"}`,
    `Principals: ${principals.join(", ") || "-"}`,
  ].join("\n");
}

function formatAllowHelp() {
  return [
    "Admin access commands:",
    "- /allow <telegram-id-or-username>",
    "- /deny <telegram-id-or-username>",
    "- /allowlist",
    "- /authority_users",
    "- /authority_remove <telegram-id-or-username>",
  ].join("\n");
}

function isHelloStopCommand(text) {
  return /^\/?(?:hello_stop|stop_hello|bye_hello|quit_hello)$/i.test(String(text || "").trim());
}

function isAllScopeReply(text) {
  return /^(?:all|total|genel|hepsi)$/i.test(String(text || "").trim());
}

function isAccessRequestsCommand(text) {
  return /^\/?access_requests\b/i.test(String(text || "").trim());
}

function pendingAccessRequestsKeyboard(requests = []) {
  return {
    inline_keyboard: requests.slice(0, 20).map((request) => [
      {
        text: request.user?.username ? `@${request.user.username}` : `ID ${request.user?.id || "unknown"}`,
        callback_data: `access:open:${request.id}`,
      },
    ]),
  };
}

function pendingAccessRequestsText(requests = []) {
  if (!requests.length) {
    return "No pending access requests.";
  }
  return [
    `Pending access requests: ${requests.length}`,
    ...requests.slice(0, 20).map((request, index) => {
      const label = request.user?.username ? `@${request.user.username}` : `ID ${request.user?.id || "unknown"}`;
      return `${index + 1}. ${label} (request: ${request.id})`;
    }),
  ].join("\n");
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
  const now = new Date();

  try {
    registerAdminChat(telegramUser, chatId);
    const authorityScope = await resolveAuthorityScopeForUser(telegramUser);
    const scopedReadRows = buildScopedReadRows(authorityScope, now);

    if (!callbackQuery && isWhoAmICommand(text)) {
      return sendMessageWebhookResponse(chatId, formatUserIdentity(telegramUser));
    }

    const allowCommand = !callbackQuery ? parseAllowCommand(text) : null;
    if (allowCommand) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can run allow/deny commands.");
      }
      const updated =
        allowCommand.action === "allow"
          ? approveTelegramUser(allowCommand.target)
          : denyTelegramUser(allowCommand.target);
      return sendMessageWebhookResponse(
        chatId,
        [
          `${allowCommand.action === "allow" ? "Allowed" : "Denied"}: ${allowCommand.target}`,
          `Matched principals: ${updated.join(", ") || "-"}`,
          "",
          "Note: this runtime allowlist resets after redeploy. Keep permanent users in ALLOWED_USERS.",
        ].join("\n"),
      );
    }

    if (!callbackQuery && /^\/?allowlist$/i.test(text)) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can run /allowlist.");
      }
      const envAllowed = [...parseAllowedUsers()].sort((left, right) => left.localeCompare(right));
      const runtimeAllowed = listRuntimeApprovals();
      const adminUsers = [...parseAdminUsers()].sort((left, right) => left.localeCompare(right));
      return sendMessageWebhookResponse(
        chatId,
        [
          "Access overview",
          `Admins (${adminUsers.length}): ${adminUsers.join(", ") || "-"}`,
          `Allowed from ALLOWED_USERS (${envAllowed.length}): ${envAllowed.join(", ") || "-"}`,
          `Runtime allowed (${runtimeAllowed.length}): ${runtimeAllowed.join(", ") || "-"}`,
          "",
          formatAllowHelp(),
        ].join("\n"),
      );
    }

    if (!callbackQuery && isAuthorityUsersCommand(text)) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can run /authority_users.");
      }
      const listing = await authorityListResponse(0);
      return sendMessageWebhookResponse(chatId, listing.text, listing.replyMarkup);
    }

    if (!callbackQuery && isAccessRequestsCommand(text)) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(
          chatId,
          "Your access request is already waiting for admin approval. Please wait.",
        );
      }
      const pending = listPendingAccessRequests();
      return sendMessageWebhookResponse(chatId, pendingAccessRequestsText(pending), pendingAccessRequestsKeyboard(pending));
    }

    const authorityRemoveCommand = !callbackQuery ? parseAuthorityRemoveCommand(text) : null;
    if (authorityRemoveCommand) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can run /authority_remove.");
      }
      const removed = await removeAuthorityUserByPrincipal(authorityRemoveCommand.principal);
      if (!removed.removed) {
        return sendMessageWebhookResponse(chatId, `No authority row found for ${authorityRemoveCommand.principal}.`);
      }
      denyTelegramUser(authorityRemoveCommand.principal);
      return sendMessageWebhookResponse(
        chatId,
        `Removed ${removed.removedRows.length} authority row(s) for ${authorityRemoveCommand.principal}.`,
      );
    }

    if (callbackQuery?.data?.startsWith("authority:")) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can manage authority users.");
      }
      const [, action, value, pageValue] = callbackQuery.data.split(":");
      if (action === "page") {
        const listing = await authorityListResponse(Number(value) || 0);
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, listing.text, listing.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, listing.text, listing.replyMarkup);
      }
      if (action === "del") {
        await removeAuthorityRowByNumber(Number(value));
        const listing = await authorityListResponse(Number(pageValue) || 0);
        const textMessage = `Authority row ${value} deleted.\n\n${listing.text}`;
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, listing.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, listing.replyMarkup);
      }
    }

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
      if (decision === "open") {
        const request = getAccessRequest(requestId);
        if (!request || request.status !== "pending") {
          return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
        }
        const textMessage = accessRequestMessage(request);
        const markup = {
          inline_keyboard: [
            [
              { text: "Approve Full", callback_data: `access:approve:${request.id}` },
              { text: "Deny", callback_data: `access:deny:${request.id}` },
            ],
            [{ text: "Grant Scoped Access", callback_data: `access:scope:${request.id}` }],
          ],
        };
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, markup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, markup);
      }
      if (decision === "scope") {
        const draft = await loadScopeDraftForRequest(requestId);
        if (!draft) {
          return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
        }
        setSession(userId, { accessScopeDraft: draft });
        const textMessage = scopeDraftPrompt(draft, "office");
        const replyMarkup = scopeDraftKeyboard(draft, "office");
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, replyMarkup);
      }
      const request = decision === "approve" ? approveAccessRequest(requestId) : denyAccessRequest(requestId);
      if (!request) {
        return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
      }

      const approved = decision === "approve";
      if (approved) {
        await upsertAuthorityUserScope({ user: request.user, offices: [], desks: [], teamLeaders: [] }).catch((error) => {
          console.error("Could not upsert full authority scope", error);
        });
      }
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
        [
          `${approved ? "Approved" : "Denied"} access for ${
            request.user?.username ? `@${request.user.username}` : request.user?.id
          }.`,
          "",
          pendingAccessRequestsText(listPendingAccessRequests()),
        ].join("\n"),
        pendingAccessRequestsKeyboard(listPendingAccessRequests()),
      );
    }

    if (callbackQuery?.data?.startsWith("accessScope:")) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can grant scoped access.");
      }
      const [, requestId, action, stage, rawValue] = callbackQuery.data.split(":");
      const session = getSession(userId);
      const currentDraft = session.accessScopeDraft;
      if (!currentDraft || currentDraft.requestId !== requestId) {
        return sendMessageWebhookResponse(chatId, "Scope selection expired. Open Grant Scoped Access again.");
      }
      let draft = normalizeScopeSelections(currentDraft);

      if (action === "cancel") {
        setSession(userId, { accessScopeDraft: null });
        return sendMessageWebhookResponse(chatId, "Scoped access flow cancelled.");
      }

      const options = valuesForScopeStage(draft, stage);
      if (action === "page") {
        draft.pageByStage = {
          ...(draft.pageByStage || {}),
          [stage]: Number(rawValue) || 0,
        };
      } else if (action === "toggle") {
        const index = Number(rawValue);
        if (!Number.isFinite(index) || !options[index]) {
          return sendMessageWebhookResponse(chatId, "Selection expired. Please try again.");
        }
        const value = options[index];
        const selected = new Set(selectedForScopeStage(draft, stage));
        if (selected.has(value)) {
          selected.delete(value);
        } else {
          selected.add(value);
        }
        const selectedList = [...selected].sort((left, right) => left.localeCompare(right));
        if (stage === "office") {
          draft.selectedOffices = selectedList;
        } else if (stage === "desk") {
          draft.selectedDesks = selectedList;
        } else {
          draft.selectedTeamLeaders = selectedList;
        }
      } else if (action === "all") {
        if (stage === "office") {
          draft.selectedOffices = [...options];
        } else if (stage === "desk") {
          draft.selectedDesks = [...options];
        } else {
          draft.selectedTeamLeaders = [...options];
        }
      } else if (action === "clear") {
        if (stage === "office") {
          draft.selectedOffices = [];
        } else if (stage === "desk") {
          draft.selectedDesks = [];
        } else {
          draft.selectedTeamLeaders = [];
        }
      } else if (action === "done") {
        if (stage === "office") {
          draft = normalizeScopeSelections(draft);
          draft.pageByStage = { ...(draft.pageByStage || {}), desk: 0 };
          setSession(userId, { accessScopeDraft: draft });
          const responseText = scopeDraftPrompt(draft, "desk");
          const responseMarkup = scopeDraftKeyboard(draft, "desk");
          if (callbackQuery.message?.message_id) {
            return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, responseText, responseMarkup);
          }
          return sendMessageWebhookResponse(chatId, responseText, responseMarkup);
        }
        if (stage === "desk") {
          draft = normalizeScopeSelections(draft);
          draft.pageByStage = { ...(draft.pageByStage || {}), teamLeader: 0 };
          setSession(userId, { accessScopeDraft: draft });
          const responseText = scopeDraftPrompt(draft, "teamLeader");
          const responseMarkup = scopeDraftKeyboard(draft, "teamLeader");
          if (callbackQuery.message?.message_id) {
            return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, responseText, responseMarkup);
          }
          return sendMessageWebhookResponse(chatId, responseText, responseMarkup);
        }
        const request = approveAccessRequest(requestId);
        if (!request) {
          setSession(userId, { accessScopeDraft: null });
          return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
        }
        await upsertAuthorityUserScope({
          user: request.user,
          offices: draft.selectedOffices || [],
          desks: draft.selectedDesks || [],
          teamLeaders: draft.selectedTeamLeaders || [],
        });
        setSession(userId, { accessScopeDraft: null });
        if (hasTelegramBotToken()) {
          await sendTelegramMessage(
            request.chatId,
            [
              "Your access request was approved.",
              "Scoped access has been assigned.",
              scopeSummaryText(draft),
            ].join("\n"),
          ).catch((error) => {
            console.error("Could not notify scoped access requester", error);
          });
        }
        return sendMessageWebhookResponse(
          chatId,
          [
            `Scoped access approved for ${request.user?.username ? `@${request.user.username}` : request.user?.id}.`,
            scopeSummaryText(draft),
          ].join("\n"),
        );
      }

      draft = normalizeScopeSelections(draft);
      setSession(userId, { accessScopeDraft: draft });
      const responseText = scopeDraftPrompt(draft, stage);
      const responseMarkup = scopeDraftKeyboard(draft, stage);
      if (callbackQuery.message?.message_id) {
        return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, responseText, responseMarkup);
      }
      return sendMessageWebhookResponse(chatId, responseText, responseMarkup);
    }

    if (!isAllowedTelegramUser(telegramUser || userId) && !authorityScope.allowed) {
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
          ? [
              "You are not authorized yet.",
              "Your request was sent to admins. Please wait for approval.",
              `Request ID: ${accessRequest.id}`,
              formatUserIdentity(telegramUser),
            ].join("\n")
          : [
              `${UNAUTHORIZED_MESSAGE} Your request is saved and waiting for admin approval.`,
              `Request ID: ${accessRequest.id}`,
              formatUserIdentity(telegramUser),
              "Please wait until an admin approves your access.",
            ].join("\n"),
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
      setSession(userId, { step: null, dbCheckStep: null, view: null, chatAssistant: null });
      return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
    }

    if (!callbackQuery && isHelpCommand(text)) {
      return sendMessageWebhookResponse(chatId, buildHelpText(telegramUser));
    }

    if (!callbackQuery && isHelloCommand(text)) {
      setSession(userId, {
        step: null,
        dbCheckStep: null,
        view: null,
        chatAssistant: { active: true, pendingQuery: null },
      });
      return sendMessageWebhookResponse(chatId, HELLO_MESSAGE);
    }

    if (!callbackQuery && isHelloStopCommand(text)) {
      setSession(userId, { chatAssistant: null });
      return sendMessageWebhookResponse(chatId, "Hello mode stopped. Use /hello to start again.");
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

      const response = await handleMenuCallback(userId, callbackQuery.data, {
        telegramUser,
        authorityScope,
      });
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

    const menuTextResponse = await handleMenuText(userId, text, { telegramUser, authorityScope });
    if (menuTextResponse) {
      return sendMessageWebhookResponse(
        chatId,
        menuTextResponse.text,
        menuTextResponse.replyMarkup,
      );
    }

    const session = getSession(userId);
    if (!callbackQuery && session.chatAssistant?.active) {
      const pendingQuery = session.chatAssistant.pendingQuery;
      if (pendingQuery) {
        const finalQuery = isAllScopeReply(text) ? pendingQuery : `${pendingQuery} ${text}`;
        const resolved = await answerQueryDetailed(finalQuery, {
          now,
          readRows: scopedReadRows,
          scopeFilters: scopeFiltersFromAuthority(authorityScope),
        });
        setSession(userId, {
          chatAssistant: { ...session.chatAssistant, pendingQuery: null },
        });
        return sendMessageWebhookResponse(chatId, resolved.text);
      }

      const resolved = await answerQueryDetailed(text, {
        now,
        readRows: scopedReadRows,
        scopeFilters: scopeFiltersFromAuthority(authorityScope),
      });
      if (shouldAskScopeFollowUp(resolved.parsed, resolved.filters)) {
        setSession(userId, {
          chatAssistant: { ...session.chatAssistant, pendingQuery: text },
        });
        return sendMessageWebhookResponse(
          chatId,
          "Hangi scope ile bakayım? Country / Office (Desk) / Team Leader / Agent yazabilirsin. `all` yazarsan toplam sonucu veririm.",
        );
      }
      return sendMessageWebhookResponse(chatId, resolved.text);
    }

    if (isGreeting(text)) {
      return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
    }

    const answer = await answerQuery(text, {
      now,
      readRows: scopedReadRows,
      scopeFilters: scopeFiltersFromAuthority(authorityScope),
    });
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
