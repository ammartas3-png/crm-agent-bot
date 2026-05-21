import { getSession, setSession } from "./session.js";
import { validateCommentStatusRows } from "./commentStatusValidator.js";
import { buildReviewWorkbookBuffer, readInputWorkbookRows } from "./excelReviewExporter.js";
import { ACTIONS, canAccessAction } from "./actionPermissions.js";
import { parseAdminUsers } from "./permissions.js";
import {
  addNegativeKeyword,
  addPositiveKeyword,
  formatRulesSummary,
  listRulesFromSheet,
  removeNegativeKeyword,
  removePositiveKeyword,
} from "./ruleSheetService.js";

export const ROOT_START_TEXT = "Select section:";

export function rootStartKeyboard(telegramUser) {
  const rows = [[{ text: "Results from Months Table", callback_data: "root:results" }]];
  if (canAccessAction(telegramUser, ACTIONS.DATABASE_CHECK)) {
    rows.push([{ text: "Database Check", callback_data: "dbcheck:open" }]);
  }
  return { inline_keyboard: rows };
}

export function databaseCheckMenuKeyboard(isAdmin = false) {
  const rows = [
    [{ text: "Upload CRM Excel", callback_data: "dbcheck:upload" }],
    [{ text: "List Rules", callback_data: "dbcheck:list" }],
    [{ text: "Show Admins", callback_data: "dbcheck:admins" }],
    [{ text: "Back to Section Select", callback_data: "root:start" }],
  ];
  if (isAdmin) {
    rows.splice(2, 0, [{ text: "Add Positive Keyword", callback_data: "dbcheck:addPositive" }]);
    rows.splice(3, 0, [{ text: "Remove Positive Keyword", callback_data: "dbcheck:removePositive" }]);
    rows.splice(4, 0, [{ text: "Add Negative Keyword", callback_data: "dbcheck:addNegative" }]);
    rows.splice(5, 0, [{ text: "Remove Negative Keyword", callback_data: "dbcheck:removeNegative" }]);
  }
  return { inline_keyboard: rows };
}

function formatAdminListText() {
  const admins = [...parseAdminUsers()].filter(Boolean);
  const adminLabels = admins
    .map((admin) => (String(admin).startsWith("@") ? String(admin) : `@${admin}`))
    .sort((a, b) => a.localeCompare(b));
  if (!adminLabels.length) {
    return "No admins configured.";
  }
  return `Authorized admins: ${adminLabels.join(", ")}`;
}

export function parseStatusKeywordInput(text) {
  const parts = String(text || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return {
    status: parts[0],
    keyword: parts.slice(1).join(" | "),
  };
}

export async function handleDatabaseCheckCallback(userId, callbackData, options = {}) {
  const telegramUser = options.telegramUser;
  const isAdmin = Boolean(options.isAdmin);
  if (!canAccessAction(telegramUser, ACTIONS.DATABASE_CHECK)) {
    return {
      text: "Database Check is currently available to admins only.",
      replyMarkup: rootStartKeyboard(telegramUser),
    };
  }
  if (callbackData === "dbcheck:open") {
    return {
      text: `Database Check\nUpload CRM Excel for rule-based status validation.\n${formatAdminListText()}`,
      replyMarkup: databaseCheckMenuKeyboard(isAdmin),
    };
  }
  if (callbackData === "dbcheck:upload") {
    setSession(userId, { dbCheckStep: "await_file" });
    return {
      text: "Upload Excel file now (.xlsx or .xls).",
      replyMarkup: databaseCheckMenuKeyboard(isAdmin),
    };
  }
  if (callbackData === "dbcheck:list") {
    const rules = await listRulesFromSheet();
    return {
      text: formatRulesSummary(rules),
      replyMarkup: databaseCheckMenuKeyboard(isAdmin),
    };
  }
  if (callbackData === "dbcheck:admins") {
    return {
      text: formatAdminListText(),
      replyMarkup: databaseCheckMenuKeyboard(isAdmin),
    };
  }

  const stepByCallback = {
    "dbcheck:addPositive": "add_positive",
    "dbcheck:removePositive": "remove_positive",
    "dbcheck:addNegative": "add_negative",
    "dbcheck:removeNegative": "remove_negative",
  };
  const nextStep = stepByCallback[callbackData];
  if (nextStep) {
    if (!isAdmin) {
      return {
        text: "Only authorized admins can manage keywords.",
        replyMarkup: databaseCheckMenuKeyboard(false),
      };
    }
    setSession(userId, { dbCheckStep: nextStep });
    return {
      text: "Send as:\nStatus | keyword",
      replyMarkup: databaseCheckMenuKeyboard(isAdmin),
    };
  }

  return null;
}

export async function handleDatabaseCheckText(userId, text, options = {}) {
  const isAdmin = Boolean(options.isAdmin);
  const session = getSession(userId);
  const step = session.dbCheckStep;
  if (!step || step === "await_file") {
    return null;
  }
  if (!isAdmin) {
    return {
      text: "Only authorized admins can manage keywords.",
      replyMarkup: databaseCheckMenuKeyboard(false),
    };
  }
  const parsed = parseStatusKeywordInput(text);
  if (!parsed) {
    return {
      text: "Invalid format. Send as:\nStatus | keyword",
      replyMarkup: databaseCheckMenuKeyboard(true),
    };
  }

  const operation = {
    add_positive: () => addPositiveKeyword(parsed.status, parsed.keyword),
    remove_positive: () => removePositiveKeyword(parsed.status, parsed.keyword),
    add_negative: () => addNegativeKeyword(parsed.status, parsed.keyword),
    remove_negative: () => removeNegativeKeyword(parsed.status, parsed.keyword),
  }[step];

  if (!operation) {
    return null;
  }

  const result = await operation();
  setSession(userId, { dbCheckStep: null });
  return {
    text: `${result.changed ? "Updated" : "No change"}: ${result.status}\nKeywords: ${
      result.keywords.join(", ") || "-"
    }`,
    replyMarkup: databaseCheckMenuKeyboard(true),
  };
}

export async function processDatabaseCheckWorkbook(fileBuffer) {
  const rules = await listRulesFromSheet();
  const activeRules = rules.filter((rule) => rule.active);
  const rows = readInputWorkbookRows(fileBuffer);
  const validation = validateCommentStatusRows(rows, activeRules);
  const outputBuffer = buildReviewWorkbookBuffer(validation.flaggedRows);
  return {
    outputBuffer,
    outputFilename: "crm_comment_status_review.xlsx",
    summary: validation.summary,
    flaggedRowsCount: validation.flaggedRows.length,
  };
}

export function formatDatabaseCheckSummary(summary, flaggedRowsCount) {
  return [
    "Database Check Completed",
    `Total rows checked: ${summary.totalRows}`,
    `Correct rows skipped: ${summary.skippedCorrect}`,
    `Status changes suggested: ${summary.statusChanges}`,
    `Manual checks: ${summary.manualChecks}`,
    `Appointment checks: ${summary.appointmentChecks}`,
    `Rows in output: ${flaggedRowsCount}`,
  ].join("\n");
}
