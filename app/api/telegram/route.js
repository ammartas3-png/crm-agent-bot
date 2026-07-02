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
  hydrateApprovedUsers,
  hydrateRegistryAllowedUsers,
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
import {
  filterRowsByPermission,
  filteredRows,
  getFieldName,
  getRowValue,
  normalizeText,
  permissionFilterDebug,
} from "../../../lib/calculations.js";
import { getGoogleCredentialConfig, readSheetRows } from "../../../lib/googleSheets.js";
import { loadLeadRows, readDashboardSheetRows } from "../../../lib/dataProvider.js";
import { buildAnswerContext } from "../../../lib/aiAgent.js";
import { aiConfigured, generateAiReply } from "../../../lib/aiResponder.js";
import { clearAuthorityScopeCache, resolveAuthorityScopeForUser } from "../../../lib/authorityScope.js";
import { getMonthFile, listMonthFiles } from "../../../lib/monthlyReports.js";
import { getOfficeMonthMap } from "../../../lib/officeMappings.js";
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
import { getSession, hydrateSession, setSession } from "../../../lib/session.js";
import { checkRateLimit, rateLimitKeyFromTelegramUser } from "../../../lib/rateLimit.js";
import { flushPersistence } from "../../../lib/store.js";
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

const PREFERRED_OFFICE_COUNTRIES = ["Turkey", "Pakistan", "Argentina", "United Arab Emirates"];
const OFFICE_COUNTRY_MATCHERS = [
  { label: "Turkey", patterns: ["turkey", "turkiye", "türkiye"] },
  { label: "Pakistan", patterns: ["pakistan"] },
  { label: "Argentina", patterns: ["argentina", "aragantin"] },
  { label: "United Arab Emirates", patterns: ["united arab emirates", "uae", "emirates"] },
];

function officeCountryFromOfficeName(office = "") {
  const normalizedOffice = normalizeText(office);
  if (!normalizedOffice) {
    return "";
  }
  const matched = OFFICE_COUNTRY_MATCHERS.find((entry) =>
    entry.patterns.some((pattern) => normalizedOffice.includes(pattern)),
  );
  return matched?.label || office;
}

function buildAccessScopeContext(rows = [], tabConfig) {
  const officeField = getFieldName(tabConfig, "office");
  const deskField = getFieldName(tabConfig, "desk") || getFieldName(tabConfig, "office");
  const teamLeaderField = getFieldName(tabConfig, "teamLeader");
  const triples = [];
  const seen = new Set();
  for (const row of rows) {
    const scopeOfficeName = String(row.__scopeOfficeName || "").trim();
    const office = String(scopeOfficeName || getRowValue(row, officeField) || "").trim();
    const desk = String(getRowValue(row, deskField) || "").trim();
    const teamLeader = String(getRowValue(row, teamLeaderField) || "").trim();
    const team = teamLeader;
    const country = officeCountryFromOfficeName(scopeOfficeName || office);
    const key = `${country.toLocaleLowerCase("en-US")}::${office.toLocaleLowerCase("en-US")}::${desk.toLocaleLowerCase(
      "en-US",
    )}::${team.toLocaleLowerCase(
      "en-US",
    )}::${teamLeader.toLocaleLowerCase(
      "en-US",
    )}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    triples.push({ country, office, desk, team, teamLeader });
  }
  const detectedCountries = uniqueSorted(triples.map((item) => item.country));
  return {
    triples,
    countries: uniqueSorted([...PREFERRED_OFFICE_COUNTRIES, ...detectedCountries]),
  };
}

function officesForSelectedCountries(draft = {}) {
  const selectedOffices = uniqueSorted(draft.selectedOffices || []);
  if (selectedOffices.length) {
    return selectedOffices;
  }
  return [];
}

function valuesForScopeStage(draft = {}, stage = "office") {
  const triples = draft.scopeTriples || [];
  const selectedOffices = uniqueSorted(draft.selectedOffices || []);
  const selectedOfficeSet = new Set(selectedOffices);
  const selectedDesks = new Set(draft.selectedDesks || []);
  if (stage === "office") {
    return uniqueSorted(draft.officeOptions || []);
  }
  if (stage === "desk") {
    const filtered = selectedOfficeSet.size
      ? triples.filter((item) => selectedOfficeSet.has(item.office))
      : triples;
    return uniqueSorted(filtered.map((item) => item.desk));
  }
  const filteredByOffice = selectedOfficeSet.size
    ? triples.filter((item) => selectedOfficeSet.has(item.office))
    : triples;
  const filteredByDesk = selectedDesks.size
    ? filteredByOffice.filter((item) => selectedDesks.has(item.desk))
    : filteredByOffice;
  return uniqueSorted(filteredByDesk.map((item) => item.team || item.teamLeader));
}

function selectedForScopeStage(draft = {}, stage = "office") {
  if (stage === "office") {
    return draft.selectedOffices || [];
  }
  if (stage === "desk") {
    return draft.selectedDesks || [];
  }
  return draft.selectedTeams || [];
}

function normalizeScopeSelections(draft = {}) {
  const next = { ...draft };
  const validOffices = new Set(valuesForScopeStage(next, "office"));
  next.selectedOffices = (next.selectedOffices || []).filter((value) => validOffices.has(value));
  const validDesks = new Set(valuesForScopeStage(next, "desk"));
  next.selectedDesks = (next.selectedDesks || []).filter((value) => validDesks.has(value));
  const validTeams = new Set(valuesForScopeStage(next, "team"));
  next.selectedTeams = (next.selectedTeams || []).filter((value) => validTeams.has(value));
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
    return "Office Country";
  }
  if (stage === "desk") {
    return "Desk";
  }
  return "Team";
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
  const stageLabel = scopeStageLabel(stage);
  return [
    `Grant scoped access — ${stageLabel} selection`,
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
  const rows = await loadScopeRowsForDraft();
  const scope = buildAccessScopeContext(rows, getTabConfig("leads"));
  let officeOptions = scope.countries;
  try {
    const officeMap = await getOfficeMonthMap();
    if (Array.isArray(officeMap.offices) && officeMap.offices.length) {
      officeOptions = officeMap.offices;
    }
  } catch {
    officeOptions = scope.countries;
  }
  return {
    requestId,
    mode: "accessRequest",
    targetUser: request.user,
    targetId: request.user?.id ? String(request.user.id) : "",
    targetUsername: request.user?.username ? `@${request.user.username}` : "",
    scopeTriples: scope.triples,
    officeOptions,
    selectedOffices: [],
    selectedDesks: [],
    selectedTeams: [],
    pageByStage: { office: 0, desk: 0, team: 0 },
    authorityRole: "Manager",
  };
}

function parseScopeCellValues(value = "") {
  const text = String(value || "").trim();
  if (!text || normalizeText(text) === "all") {
    return [];
  }
  return uniqueSorted(text.split(",").map((item) => item.trim()).filter(Boolean));
}

function authorityUserFromRow(row = {}) {
  const username = String(row.telegramUsername || "")
    .trim()
    .replace(/^@/, "");
  const user = {
    id: row.telegramId || "",
    username,
    first_name: row.userName || username || row.telegramId || "Authority User",
  };
  return user;
}

async function loadScopeRowsForDraft() {
  let officeMonths = [];
  try {
    const officeMap = await getOfficeMonthMap();
    officeMonths = Object.values(officeMap.byOffice || {})
      .flatMap((items) => [...(Array.isArray(items) ? items : [])])
      .filter(Boolean);
  } catch {
    officeMonths = [];
  }
  const uniqueMonthsBySheetId = new Map();
  for (const month of officeMonths) {
    const sheetId = String(month?.sheet_id || "").trim();
    if (!sheetId || uniqueMonthsBySheetId.has(sheetId)) {
      continue;
    }
    uniqueMonthsBySheetId.set(sheetId, month);
  }
  if (!uniqueMonthsBySheetId.size) {
    const fallbackMonths = listMonthFiles()
      .filter((item) => item?.active !== false)
      .sort((left, right) => String(right?.key || "").localeCompare(String(left?.key || "")))
      .slice(0, 6);
    for (const month of fallbackMonths) {
      const sheetId = String(month?.sheet_id || "").trim();
      if (!sheetId || uniqueMonthsBySheetId.has(sheetId)) {
        continue;
      }
      uniqueMonthsBySheetId.set(sheetId, month);
    }
  }
  const tabConfig = getTabConfig("leads");
  const monthRows = await Promise.all(
    [...uniqueMonthsBySheetId.values()].map(async (month) => {
      try {
        const rows = await readDashboardSheetRows("leads", {
          tabConfig,
          spreadsheetId: month?.sheet_id,
          office: month?.office_name || "",
          period: month?.key || month?.period || "",
        });
        const scopeOfficeName = String(month?.office_name || "").trim();
        if (!scopeOfficeName) {
          return rows;
        }
        return rows.map((row) => ({
          ...row,
          __scopeOfficeName: scopeOfficeName,
        }));
      } catch (error) {
        console.error("Could not read scope options from month file", month?.key, error);
        return [];
      }
    }),
  );
  return monthRows.flat();
}

async function loadScopeDraftForAuthorityRow(rowNumber) {
  const rows = await readAuthorityRows();
  const row = rows.find((item) => Number(item.rowNumber) === Number(rowNumber));
  if (!row) {
    return null;
  }
  const leadsRows = await loadScopeRowsForDraft();
  const scope = buildAccessScopeContext(leadsRows, getTabConfig("leads"));
  const selectedOffices = parseScopeCellValues(row.office);
  let officeOptions = scope.countries;
  try {
    const officeMap = await getOfficeMonthMap();
    if (Array.isArray(officeMap.offices) && officeMap.offices.length) {
      officeOptions = officeMap.offices;
    }
  } catch {
    officeOptions = scope.countries;
  }
  return {
    requestId: `authority-${row.rowNumber}`,
    mode: "authorityEdit",
    authorityRowNumber: row.rowNumber,
    targetUser: authorityUserFromRow(row),
    targetId: row.telegramId || "",
    targetUsername: row.telegramUsername || "",
    scopeTriples: scope.triples,
    officeOptions,
    selectedOffices,
    selectedDesks: parseScopeCellValues(row.desk),
    selectedTeams: parseScopeCellValues(row.team),
    pageByStage: { office: 0, desk: 0, team: 0 },
    authorityRole: row.authority || "Manager",
  };
}

function accessRequestsRootKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Pending Requests", callback_data: "root:access_requests:pending" }],
      [{ text: "Registered Users", callback_data: "root:access_requests:users:0" }],
      [{ text: "Back to Section Select", callback_data: "root:start" }],
    ],
  };
}

function accessRequestsRootText() {
  return "Access Management\nChoose what to review:";
}

function authorityManageListKeyboard(rows = [], page = 0) {
  const { page: safePage, totalPages, chunk } = paginateList(rows, page, 10);
  const keyboardRows = chunk.map((row) => [
    {
      text: authorityRowDisplayLabel(row),
      callback_data: `accessManage:user:${row.rowNumber}:${safePage}`,
    },
  ]);
  if (totalPages > 1) {
    keyboardRows.push([
      { text: "Previous Page", callback_data: `root:access_requests:users:${Math.max(safePage - 1, 0)}` },
      { text: "Next Page", callback_data: `root:access_requests:users:${Math.min(safePage + 1, totalPages - 1)}` },
    ]);
  }
  keyboardRows.push([{ text: "Back to Access Management", callback_data: "root:access_requests" }]);
  return { inline_keyboard: keyboardRows };
}

async function authorityManageListResponse(page = 0) {
  const rows = await readAuthorityRows();
  if (!rows.length) {
    return { text: "No registered authority users found.", replyMarkup: accessRequestsRootKeyboard() };
  }
  const { page: safePage, totalPages, chunk, start } = paginateList(rows, page, 10);
  const text = [
    `Registered Users (Page ${safePage + 1}/${totalPages})`,
    ...chunk.map((row, index) => `${start + index + 1}. ${authorityRowDisplayLabel(row)}`),
  ].join("\n");
  return { text, replyMarkup: authorityManageListKeyboard(rows, safePage) };
}

function authorityManageUserKeyboard(row = {}, page = 0) {
  return {
    inline_keyboard: [
      [{ text: "Edit Permissions", callback_data: `accessManage:edit:${row.rowNumber}:${page}` }],
      [{ text: "Delete User", callback_data: `accessManage:del:${row.rowNumber}:${page}` }],
      [{ text: "Back to Registered Users", callback_data: `root:access_requests:users:${page}` }],
      [{ text: "Back to Access Management", callback_data: "root:access_requests" }],
    ],
  };
}

function authorityManageUserText(row = {}) {
  return [
    `User: ${authorityRowDisplayLabel(row)}`,
    `Office: ${row.office || "all"}`,
    `Desk: ${row.desk || "all"}`,
    `Team: ${row.team || "all"}`,
    `Authority: ${row.authority || "all"}`,
  ].join("\n");
}

async function authorityManageUserResponse(rowNumber, page = 0) {
  const rows = await readAuthorityRows();
  const row = rows.find((item) => Number(item.rowNumber) === Number(rowNumber));
  if (!row) {
    return { text: "User not found.", replyMarkup: accessRequestsRootKeyboard() };
  }
  return {
    text: authorityManageUserText(row),
    replyMarkup: authorityManageUserKeyboard(row, page),
  };
}

function pendingAccessRequestsKeyboard(requests = []) {
  const rows = requests.slice(0, 20).map((request) => [
    {
      text: request.user?.username ? `@${request.user.username}` : `ID ${request.user?.id || "unknown"}`,
      callback_data: `access:open:${request.id}`,
    },
  ]);
  rows.push([{ text: "Back to Access Management", callback_data: "root:access_requests" }]);
  return {
    inline_keyboard: rows,
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

// Legacy command helpers and callbacks below.

function scopeSummaryText(draft = {}) {
  const officeScopes = draft.selectedOffices?.length ? draft.selectedOffices.join(", ") : "all";
  const resolvedOffices = officesForSelectedCountries(draft);
  const offices = resolvedOffices.length ? resolvedOffices.join(", ") : "all";
  const desks = draft.selectedDesks?.length ? draft.selectedDesks.join(", ") : "all";
  const teams = draft.selectedTeams?.length ? draft.selectedTeams.join(", ") : "all";
  return [`Office Scope: ${officeScopes}`, `Office: ${offices}`, `Desk: ${desks}`, `Team: ${teams}`].join("\n");
}

function setScopeStageSelection(draft = {}, stage = "office", values = []) {
  if (stage === "office") {
    draft.selectedOffices = values;
    return;
  }
  if (stage === "desk") {
    draft.selectedDesks = values;
    return;
  }
  draft.selectedTeams = values;
}

function nextScopeStage(_draft = {}, currentStage = "office") {
  if (currentStage === "office") {
    return "desk";
  }
  if (currentStage === "desk") {
    return "team";
  }
  return null;
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
        } | Team: ${row.team || "all"} | Authority: ${row.authority || "all"}`,
    ),
  ].join("\n\n");
  return { text, replyMarkup: authorityListKeyboard(rows, safePage) };
}

const AI_MODE_PROMPT =
  "🤖 AI Assistant is on. Ask a CRM reporting question (agent, desk, country, campaign, FTD, CR…).\n" +
  "Tip: you can also ask in one line, e.g. /ask how many FTD in Dubai this month.\n" +
  "Type /menu to exit.";

function isAiEnterCommand(text = "") {
  return /^\/?(ai|ask|asistan|assistant)\b/i.test(String(text || "").trim());
}

// Returns the question after "/ai", "/ask", etc. when the user asks in a single
// message (e.g. "/ask how many FTD in Dubai"). Empty string means no inline
// question, so we just enter AI mode.
function aiInlineQuestion(text = "") {
  const match = String(text || "")
    .trim()
    .match(/^\/?(?:ai|ask|asistan|assistant)\b[\s,:-]*([\s\S]+)$/i);
  return match ? match[1].trim() : "";
}

function isAiExitCommand(text = "") {
  return /^\/?(menu|exit|cikis|çıkış|quit|raporlar|reports)\b/i.test(String(text || "").trim());
}

// Builds a grounded AI answer from the ingested (Redis) dataset and relays it to
// the n8n OpenAI workflow (AI_N8N_WEBHOOK_URL) or direct OpenAI, falling back to
// a deterministic summary. The LLM only ever sees compact aggregated facts.
async function answerWithAiAgent(question, { authorityScope, now }) {
  const tabConfig = getTabConfig("leads");
  const rows = await loadLeadRows("leads", { tabConfig });
  const context = buildAnswerContext({
    question,
    rows,
    tabConfig,
    now,
    scopeFilters: scopeFiltersFromAuthority(authorityScope),
  });
  return generateAiReply(context);
}

function buildScopedReadRows(authorityScope = {}, now = new Date()) {
  // Read from the ingested Redis dataset when available (synced by n8n), with a
  // transparent fallback to live Google Sheets. Keeps the bot's free-text query
  // reports as fast as the web dashboard.
  return async (tabKey, options = {}) => {
    return readDashboardSheetRows(tabKey, options);
  };
}

async function botRateLimitMessage(telegramUser) {
  if (isAdminTelegramUser(telegramUser)) {
    return "";
  }
  const result = await checkRateLimit(rateLimitKeyFromTelegramUser(telegramUser), {
    prefix: "BOT_RATE_LIMIT",
    max: Number(process.env.BOT_RATE_LIMIT_MAX) > 0 ? Number(process.env.BOT_RATE_LIMIT_MAX) : 20,
    windowMs: Number(process.env.BOT_RATE_LIMIT_WINDOW_MS) > 0 ? Number(process.env.BOT_RATE_LIMIT_WINDOW_MS) : 60_000,
  });
  if (result.allowed) {
    return "";
  }
  const waitSeconds = Math.max(1, Math.ceil(Number(result.retryAfterMs || 0) / 1000));
  return `Too many report requests. Please wait ${waitSeconds}s and try again.`;
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

function isDebugAccessCommand(text) {
  return /^\/?debug_access\b/i.test(String(text || "").trim());
}

function formatUserIdentity(telegramUser) {
  const principals = telegramUserPrincipals(telegramUser);
  return [
    `Telegram ID: ${telegramUser?.id ?? "-"}`,
    `Username: ${telegramUser?.username ? `@${telegramUser.username}` : "-"}`,
    `Principals: ${principals.join(", ") || "-"}`,
  ].join("\n");
}

function formatValueList(values = [], limit = 10) {
  const normalized = [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!normalized.length) {
    return "-";
  }
  if (normalized.length <= limit) {
    return normalized.join(", ");
  }
  return `${normalized.slice(0, limit).join(", ")} (+${normalized.length - limit} more)`;
}

async function buildDebugAccessReport({ telegramUser, authorityScope, userId, now = new Date() }) {
  const isAdmin = isAdminTelegramUser(telegramUser) || Boolean(authorityScope?.unrestricted);
  const authorityFilters = scopeFiltersFromAuthority(authorityScope);
  const permissionFilters = isAdmin ? {} : authorityFilters;
  const session = getSession(userId) || {};
  const month = session?.monthKey ? getMonthFile(session.monthKey, { includeInactive: true }) : null;
  const selectedSpreadsheetId = session?.spreadsheetId || month?.sheet_id || undefined;
  const selectedFilters = session?.view?.filters || session?.view?.baseFilters || {};
  const leadsTabConfig = getTabConfig("leads");
  const leadsRows = await readSheetRows("leads", {
    tabConfig: leadsTabConfig,
    ...(selectedSpreadsheetId ? { spreadsheetId: selectedSpreadsheetId } : {}),
  });
  const permissionRows = filterRowsByPermission(leadsRows, leadsTabConfig, permissionFilters);
  const selectedRows = filteredRows(permissionRows, leadsTabConfig, selectedFilters, now);
  const permissionDebug = permissionFilterDebug(leadsRows, leadsTabConfig, permissionFilters);
  const allowedDesks = [
    ...(Array.isArray(authorityFilters.desk) ? authorityFilters.desk : []),
    ...(Array.isArray(authorityFilters.officeOrDepartment) ? authorityFilters.officeOrDepartment : []),
  ];
  const lines = [
    "Access Debug",
    `Telegram username: ${telegramUser?.username ? `@${telegramUser.username}` : "-"}`,
    `Telegram ID: ${telegramUser?.id ?? "-"}`,
    `is_admin: ${isAdmin}`,
    `allowed offices: ${formatValueList(authorityFilters.office || [])}`,
    `allowed desks: ${formatValueList(allowedDesks)}`,
    `allowed team leaders: ${formatValueList(authorityFilters.teamLeader || [])}`,
    `allowed agents: ${formatValueList(authorityFilters.agent || [])}`,
    `selected month: ${session?.monthLabel || month?.month_label || "-"}`,
    `selected report type: ${session?.reportType || session?.view?.groupField || "-"}`,
    `dataset total rows before permission filter: ${leadsRows.length}`,
    `rows after permission filter: ${permissionRows.length}`,
    `rows after selected report filter: ${selectedRows.length}`,
    "",
    `matched office values: ${formatValueList(permissionDebug.matchedByField.office || [])}`,
    `unmatched office values: ${formatValueList(permissionDebug.unmatchedByField.office || [])}`,
    `matched desk values: ${formatValueList(permissionDebug.matchedByField.desk || [])}`,
    `unmatched desk values: ${formatValueList(permissionDebug.unmatchedByField.desk || [])}`,
    `matched team leader values: ${formatValueList(permissionDebug.matchedByField.teamLeader || [])}`,
    `unmatched team leader values: ${formatValueList(permissionDebug.unmatchedByField.teamLeader || [])}`,
    `matched agent values: ${formatValueList(permissionDebug.matchedByField.agent || [])}`,
    `unmatched agent values: ${formatValueList(permissionDebug.unmatchedByField.agent || [])}`,
    `matched country values: ${formatValueList(permissionDebug.matchedByField.country || [])}`,
    `unmatched country values: ${formatValueList(permissionDebug.unmatchedByField.country || [])}`,
  ];
  if (permissionRows.length === 0 && Object.keys(permissionFilters).length > 0) {
    lines.push(
      "",
      `permission filter causing 0: ${permissionDebug.culpritField || "unknown"}`,
      `available values (${permissionDebug.culpritField || "office"}): ${formatValueList(
        permissionDebug.availableByField[permissionDebug.culpritField || "office"] || [],
      )}`,
      `user allowed values (${permissionDebug.culpritField || "office"}): ${formatValueList(
        permissionDebug.normalizedFilters[permissionDebug.culpritField || "office"] || [],
      )}`,
      `normalized comparison examples: ${formatValueList(
        (permissionDebug.steps || []).map((step) => `${step.field}:${step.before}->${step.after}`),
      )}`,
    );
  }
  return lines.join("\n");
}

function formatAllowHelp() {
  return [
    "Admin access commands:",
    "- /allow <telegram-id-or-username>",
    "- /deny <telegram-id-or-username>",
    "- /allowlist",
    "- /debug_access",
    "- /authority_users",
    "- /authority_remove <telegram-id-or-username>",
  ].join("\n");
}

function adminContactsText() {
  const admins = [...parseAdminUsers()]
    .filter((principal) => !/^-?\d+$/.test(principal))
    .map((principal) => `@${principal}`)
    .sort((left, right) => left.localeCompare(right));
  return admins.join(", ") || "-";
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

export const maxDuration = 300;

export async function POST(request) {
  const response = await handleTelegramUpdate(request);
  // Ensure fire-and-forget KV writes (sessions, approvals, AI mode) complete
  // before the serverless function freezes, so state survives across instances.
  await flushPersistence().catch(() => {});
  return response;
}

async function handleTelegramUpdate(request) {
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
    // Load any persisted session from KV so multi-step flows (e.g. AI mode)
    // survive across serverless instances/cold starts.
    await Promise.all([hydrateSession(userId), hydrateApprovedUsers(), hydrateRegistryAllowedUsers()]).catch(() => {});
    registerAdminChat(telegramUser, chatId);
    const authorityScope = await resolveAuthorityScopeForUser(telegramUser);
    const scopedReadRows = buildScopedReadRows(authorityScope, now);
    const menuOptions = { telegramUser, authorityScope, readRows: scopedReadRows, now };

    if (!callbackQuery && isWhoAmICommand(text)) {
      return sendMessageWebhookResponse(chatId, formatUserIdentity(telegramUser));
    }

    if (!callbackQuery && isDebugAccessCommand(text)) {
      const debugText = await buildDebugAccessReport({ telegramUser, authorityScope, userId, now });
      return sendMessageWebhookResponse(chatId, debugText);
    }

    if (!callbackQuery && isAiEnterCommand(text)) {
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can use the AI Assistant.");
      }
      const inlineQuestion = aiInlineQuestion(text);
      if (inlineQuestion) {
        // Stateless one-shot: "/ask <question>" answers immediately without
        // relying on session state surviving across serverless instances.
        const reply = await answerWithAiAgent(inlineQuestion, { authorityScope, now });
        return sendMessageWebhookResponse(chatId, reply);
      }
      setSession(userId, { aiMode: true });
      return sendMessageWebhookResponse(chatId, AI_MODE_PROMPT);
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
      return sendMessageWebhookResponse(chatId, accessRequestsRootText(), accessRequestsRootKeyboard());
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
      clearAuthorityScopeCache();
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
        clearAuthorityScopeCache();
        const listing = await authorityListResponse(Number(pageValue) || 0);
        const textMessage = `Authority row ${value} deleted.\n\n${listing.text}`;
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, listing.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, listing.replyMarkup);
      }
    }

    if (callbackQuery?.data?.startsWith("accessManage:")) {
      if (hasTelegramBotToken()) {
        await answerCallbackQuery(callbackQuery.id).catch(() => {});
      }
      if (!isAdminTelegramUser(telegramUser)) {
        return sendMessageWebhookResponse(chatId, "Only admins can manage authority users.");
      }
      const [, action, rowValue, pageValue] = callbackQuery.data.split(":");
      const rowNumber = Number(rowValue);
      const page = Number(pageValue) || 0;
      if (action === "user") {
        const response = await authorityManageUserResponse(rowNumber, page);
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, response.text, response.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
      }
      if (action === "del") {
        await removeAuthorityRowByNumber(rowNumber);
        clearAuthorityScopeCache();
        const listing = await authorityManageListResponse(page);
        const textMessage = `Authority row ${rowNumber} deleted.\n\n${listing.text}`;
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, listing.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, listing.replyMarkup);
      }
      if (action === "edit") {
        const draft = await loadScopeDraftForAuthorityRow(rowNumber);
        if (!draft) {
          return sendMessageWebhookResponse(chatId, "Selected user could not be loaded.");
        }
        setSession(userId, { accessScopeDraft: draft });
        const textMessage = scopeDraftPrompt(draft, "office");
        const replyMarkup = scopeDraftKeyboard(draft, "office");
        if (callbackQuery.message?.message_id) {
          return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, textMessage, replyMarkup);
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
            [{ text: "Back to Pending Requests", callback_data: "root:access_requests:pending" }],
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
        await upsertAuthorityUserScope({
          user: request.user,
          offices: [],
          desks: [],
          teams: [],
          authorityRole: "all",
        }).catch((error) => {
          console.error("Could not upsert full authority scope", error);
        });
        clearAuthorityScopeCache();
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
      const [, requestId, action, rawStage, rawValue] = callbackQuery.data.split(":");
      const stage = rawStage === "teamLeader" ? "team" : rawStage;
      const session = getSession(userId);
      const currentDraft = session.accessScopeDraft;
      if (!currentDraft || currentDraft.requestId !== requestId) {
        return sendMessageWebhookResponse(chatId, "Scope selection expired. Open Grant Scoped Access again.");
      }
      let draft = normalizeScopeSelections(currentDraft);

      if (action === "cancel") {
        setSession(userId, { accessScopeDraft: null });
        if (draft.mode === "authorityEdit") {
          const response = await authorityManageUserResponse(draft.authorityRowNumber, 0);
          const textMessage = `Permission edit cancelled.\n\n${response.text}`;
          if (callbackQuery.message?.message_id) {
            return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, textMessage, response.replyMarkup);
          }
          return sendMessageWebhookResponse(chatId, textMessage, response.replyMarkup);
        }
        return sendMessageWebhookResponse(chatId, "Scoped access flow cancelled.", accessRequestsRootKeyboard());
      }

      const stageActions = new Set(["page", "toggle", "all", "clear", "done"]);
      if (stageActions.has(action) && !stage) {
        return sendMessageWebhookResponse(chatId, "Scope selection expired. Please open Grant Scoped Access again.");
      }
      const options = stage ? valuesForScopeStage(draft, stage) : [];
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
        setScopeStageSelection(draft, stage, selectedList);
      } else if (action === "all") {
        setScopeStageSelection(draft, stage, [...options]);
      } else if (action === "clear") {
        setScopeStageSelection(draft, stage, []);
      } else if (action === "done") {
        draft = normalizeScopeSelections(draft);
        const nextStage = nextScopeStage(draft, stage);
        if (nextStage) {
          draft.pageByStage = { ...(draft.pageByStage || {}), [nextStage]: 0 };
          setSession(userId, { accessScopeDraft: draft });
          const responseText = scopeDraftPrompt(draft, nextStage);
          const responseMarkup = scopeDraftKeyboard(draft, nextStage);
          if (callbackQuery.message?.message_id) {
            return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, responseText, responseMarkup);
          }
          return sendMessageWebhookResponse(chatId, responseText, responseMarkup);
        }
        if (draft.mode === "authorityEdit") {
          await upsertAuthorityUserScope({
            user: draft.targetUser,
            offices: officesForSelectedCountries(draft),
            desks: draft.selectedDesks || [],
            teams: draft.selectedTeams || [],
            authorityRole: draft.authorityRole || "Manager",
          });
          clearAuthorityScopeCache();
          setSession(userId, { accessScopeDraft: null });
          const updated = await authorityManageUserResponse(draft.authorityRowNumber, 0);
          const updatedText = `Permissions updated.\n${scopeSummaryText(draft)}\n\n${updated.text}`;
          if (callbackQuery.message?.message_id) {
            return editMessageWebhookResponse(chatId, callbackQuery.message.message_id, updatedText, updated.replyMarkup);
          }
          return sendMessageWebhookResponse(chatId, updatedText, updated.replyMarkup);
        }
        const request = approveAccessRequest(requestId);
        if (!request) {
          setSession(userId, { accessScopeDraft: null });
          return sendMessageWebhookResponse(chatId, "This access request is no longer pending.");
        }
        await upsertAuthorityUserScope({
          user: request.user,
          offices: officesForSelectedCountries(draft),
          desks: draft.selectedDesks || [],
          teams: draft.selectedTeams || [],
          authorityRole: "Manager",
        });
        clearAuthorityScopeCache();
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
        if (Array.isArray(result.failed) && result.failed.length) {
          console.warn("Some admin notifications failed", result.failed);
        }
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
              `Admins: ${adminContactsText()}`,
              `Request ID: ${accessRequest.id}`,
              formatUserIdentity(telegramUser),
            ].join("\n")
          : [
              `${UNAUTHORIZED_MESSAGE} Your request is saved and waiting for admin approval.`,
              `Admins: ${adminContactsText()}`,
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
        setSession(userId, { aiMode: false });
        return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
      }
      if (callbackQuery.data === "root:ai") {
        if (!isAdminTelegramUser(telegramUser)) {
          return sendMessageWebhookResponse(chatId, "Only admins can use the AI Assistant.");
        }
        setSession(userId, { aiMode: true });
        return sendMessageWebhookResponse(chatId, AI_MODE_PROMPT);
      }
      if (callbackQuery.data === "root:results") {
        const response = await startMenu(userId, menuOptions);
        return sendMessageWebhookResponse(chatId, response.text, response.replyMarkup);
      }
      if (callbackQuery.data === "root:access_requests") {
        if (!isAdminTelegramUser(telegramUser)) {
          return sendMessageWebhookResponse(chatId, "Only admins can review access requests.");
        }
        return sendMessageWebhookResponse(chatId, accessRequestsRootText(), accessRequestsRootKeyboard());
      }
      if (callbackQuery.data === "root:access_requests:pending") {
        if (!isAdminTelegramUser(telegramUser)) {
          return sendMessageWebhookResponse(chatId, "Only admins can review access requests.");
        }
        const pending = listPendingAccessRequests();
        return sendMessageWebhookResponse(chatId, pendingAccessRequestsText(pending), pendingAccessRequestsKeyboard(pending));
      }
      if (callbackQuery.data?.startsWith("root:access_requests:users")) {
        if (!isAdminTelegramUser(telegramUser)) {
          return sendMessageWebhookResponse(chatId, "Only admins can manage registered users.");
        }
        const page = Number(callbackQuery.data.split(":")[3]) || 0;
        const listing = await authorityManageListResponse(page);
        return sendMessageWebhookResponse(chatId, listing.text, listing.replyMarkup);
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

      const rateLimitMessage = await botRateLimitMessage(telegramUser);
      if (rateLimitMessage) {
        return sendMessageWebhookResponse(chatId, rateLimitMessage);
      }

      const response = await handleMenuCallback(userId, callbackQuery.data, menuOptions);
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

    const aiSession = getSession(userId);
    if (!callbackQuery && aiSession.aiMode && isAdminTelegramUser(telegramUser)) {
      if (isAiExitCommand(text) || isGreeting(text)) {
        setSession(userId, { aiMode: false });
        return sendMessageWebhookResponse(chatId, ROOT_START_TEXT, rootStartKeyboard(telegramUser));
      }
      const reply = await answerWithAiAgent(text, { authorityScope, now });
      return sendMessageWebhookResponse(chatId, reply);
    }

    const dbTextResponse = await handleDatabaseCheckText(userId, text, {
      isAdmin: isAdminTelegramUser(telegramUser),
    });
    if (dbTextResponse) {
      return sendMessageWebhookResponse(chatId, dbTextResponse.text, dbTextResponse.replyMarkup);
    }

    const rateLimitMessage = await botRateLimitMessage(telegramUser);
    if (rateLimitMessage) {
      return sendMessageWebhookResponse(chatId, rateLimitMessage);
    }

    const menuTextResponse = await handleMenuText(userId, text, menuOptions);
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
          "Which scope should I use? You can type Country / Office (Desk) / Team Leader / Agent. Type `all` for the overall total.",
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
