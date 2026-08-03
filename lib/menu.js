import { normalizeText } from "./calculations.js";
import {
  getMonthFile,
  listMonthFiles,
  removeMonthFile,
  setMonthFileActive,
  upsertMonthFile,
} from "./monthlyReports.js";
import { isSettingsAdminTelegramUser } from "./permissions.js";
import { officeCountryFromName, officeCountryPatterns } from "./officeMappings.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  loadDashboardReport,
  officeMonthRecordsForOffice,
  resolveTelegramOfficeContext,
} from "./dashboardService.js";
import { getOrBuildExport } from "./exportCache.js";
import { dashboardReportWorkbookBuffer } from "./dashboardWorkbookExporter.js";

export const MAIN_MENU_TEXT = "Select quick report:";
const MONTH_MENU_TEXT = "Select report month:";
const OFFICE_SCOPE_TEXT = "Select office:";
const SETTINGS_MENU_TEXT = "Settings";

const SIMPLE_QUICK_REPORTS = [
  { key: "monthly", label: "Monthly Quick", monthMode: "single" },
  { key: "last4", label: "Last 4 Months Quick", monthMode: "last4" },
  { key: "traffic", label: "Traffic Reports", monthMode: "single" },
  { key: "country-daily", label: "Country Daily Watch", monthMode: "single" },
  { key: "benchmark", label: "Benchmark Report", monthMode: "all" },
  { key: "desk-country-cr", label: "Desk Country Daily CR Watch", monthMode: "single" },
  { key: "country-campaign-hourly-cr", label: "Country Campaign Hourly CR Watch", monthMode: "single" },
  { key: "status-watch", label: "Status Performance Watch", monthMode: "single" },
  { key: "comparison-report", label: "Comparison Report", monthMode: "single" },
  { key: "traffic-priority", label: "Traffic Distribution", monthMode: "all" },
  { key: "agent-productivity-plan", label: "Agent Productivity vs Plan Report", monthMode: "all" },
];
const SIMPLE_REPORT_BY_KEY = new Map(SIMPLE_QUICK_REPORTS.map((item) => [item.key, item]));

export function isGreeting(text) {
  return /^(\/?start|hello|hi|selam|merhaba)$/i.test(String(text || "").trim());
}

export function inlineKeyboard(buttonRows) {
  return {
    inline_keyboard: buttonRows.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData,
      })),
    ),
  };
}

function chunkButtons(buttons, perRow = 2) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += perRow) {
    rows.push(buttons.slice(index, index + perRow));
  }
  return rows;
}

function sessionMonthRecordByKey(session = {}, key, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const normalizedKey = String(key || "").trim();
  const hasScopedCountry = Boolean(String(session.selectedOfficeCountry || "").trim());
  const officeMonths = Array.isArray(session.officeMonthFiles) ? session.officeMonthFiles : [];
  if (hasScopedCountry) {
    const found = officeMonths.find((record) => String(record.key || "") === normalizedKey) || null;
    if (!found) {
      return null;
    }
    if (!includeInactive && found.active === false) {
      return null;
    }
    return found;
  }
  return getMonthFile(normalizedKey, { includeInactive });
}

function resolveAllowedOfficeSelection(officeName = "", allowedOffices = []) {
  const normalizedSelection = normalizeText(officeName);
  if (!normalizedSelection) {
    return "";
  }
  return allowedOffices.find((office) => normalizeText(office) === normalizedSelection) || "";
}

function isOfficeAllowed(officeName = "", allowedOffices = []) {
  return Boolean(resolveAllowedOfficeSelection(officeName, allowedOffices));
}

function settingsKeyboard() {
  return inlineKeyboard([
    [{ text: "Add / Update Month File", callbackData: "settings:add" }],
    [{ text: "List Month Files", callbackData: "settings:list" }],
    [{ text: "Remove Month File", callbackData: "settings:remove" }],
    [{ text: "Hide/Show Month File", callbackData: "settings:visibility" }],
    [{ text: "Back to Quick Reports", callbackData: "menu:main" }],
  ]);
}

function monthActionKeyboard(records, action) {
  const buttons = records.map((record) => {
    if (action === "toggle") {
      return {
        text: `${record.active ? "Hide" : "Show"} ${record.month_label}`,
        callbackData: `settingsToggle:${record.key}`,
      };
    }
    return {
      text: `Remove ${record.month_label}`,
      callbackData: `settingsRemove:${record.key}`,
    };
  });
  buttons.push({ text: "Back to Settings", callbackData: "settings:open" });
  return inlineKeyboard(chunkButtons(buttons, 1));
}

function parseMonthSheetInput(text) {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return null;
  }
  const pipeParts = rawText.split("|").map((part) => part.trim()).filter(Boolean);
  if (pipeParts.length === 2) {
    return { month: pipeParts[0], spreadsheetId: pipeParts[1] };
  }
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { month: lines[0], spreadsheetId: lines[1] };
  }
  return null;
}

function formatMonthFiles() {
  const records = listMonthFiles({ includeInactive: true });
  if (!records.length) {
    return "No month files configured yet.";
  }
  return [
    "Available month files:",
    ...records.map(
      (record) =>
        `- ${record.month_label}: ${record.sheet_id} [${record.active ? "Active" : "Inactive"}]`,
    ),
  ].join("\n");
}

async function resolveOfficeScopeForStart(options = {}) {
  const telegramUser = options.telegramUser;
  const { allowedOffices } = await resolveTelegramOfficeContext(telegramUser);
  return {
    allowedOffices,
  };
}

function canUseSimpleBotReports(options = {}) {
  const scope = options.authorityScope;
  if (!scope) {
    return true;
  }
  if (scope.admin || scope.unrestricted) {
    return true;
  }
  return Boolean(scope.botReportAccess);
}

function simpleOfficeKeyboard(offices = [], telegramUser = null) {
  const rows = chunkButtons(
    offices.map((office) => ({
      text: office,
      callbackData: `simple:office:${encodeURIComponent(office)}`,
    })),
    2,
  );
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  rows.push([{ text: "Back", callbackData: "root:start" }]);
  return inlineKeyboard(rows);
}

function simpleReportKeyboard(office = "") {
  const rows = chunkButtons(
    SIMPLE_QUICK_REPORTS.map((report) => ({
      text: report.label,
      callbackData: `simple:report:${report.key}`,
    })),
    2,
  );
  rows.push([{ text: "Change Office", callbackData: "simple:office:list" }]);
  return inlineKeyboard(rows);
}

function simpleMonthKeyboard(monthRecords = [], reportKey = "") {
  const rows = monthRecords.map((month) => [
    {
      text: month.month_label,
      callbackData: `simple:month:${reportKey}:${month.key}`,
    },
  ]);
  rows.push([{ text: "Back to Reports", callbackData: "simple:report:list" }]);
  rows.push([{ text: "Change Office", callbackData: "simple:office:list" }]);
  return inlineKeyboard(rows);
}

function safeExportFileName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function simplePresetQuery({ presetKey = "", office = "", monthKey = "", officeMonthKeys = [] } = {}) {
  const defaultMonth = monthKey ? [monthKey] : officeMonthKeys.length ? [officeMonthKeys[0]] : [];
  const selectedAllMonths = officeMonthKeys.length ? [...officeMonthKeys] : defaultMonth;
  const query = {
    officeScope: office,
    reportMode: "specific",
    specificType: "builder",
    monthKey: defaultMonth.join(","),
    includeWorkTime: "0",
    hideNotWorking: "0",
    rowDimensions: "",
    metricFields: "",
    totalDimensions: "",
    columnDimension: "",
    includeColumnGrandTotal: "0",
    benchmarkMode: "0",
    agentProductivityPlanMode: "0",
    last4QuickMode: "0",
    groupBy: "agent",
  };
  if (presetKey === "monthly") {
    query.includeWorkTime = "1";
    query.hideNotWorking = "1";
    query.rowDimensions = "desk,teamLeader,agent";
    query.metricFields = "leads,kycFtd,ftd,ftdTarget,ftdTargetReach,cr,crTarget,crTargetReach,lateFtd,lateFtdRate";
    return query;
  }
  if (presetKey === "last4") {
    query.monthKey = officeMonthKeys.slice(0, 4).join(",");
    query.columnDimension = "month";
    query.last4QuickMode = "1";
    query.includeWorkTime = "1";
    query.hideNotWorking = "1";
    query.rowDimensions = "desk,teamLeader,agent";
    query.metricFields = "ftd,ftdTarget,ftdTargetReach,cr,crTarget,crTargetReach";
    return query;
  }
  if (presetKey === "traffic") {
    query.includeWorkTime = "0";
    query.hideNotWorking = "0";
    query.rowDimensions = "desk,country,campaign,subCampaign,placement";
    query.metricFields = "leads,leadShare,agentCount,avgLeadByAgentDaily,avgLeadByAgent,ftd,crTarget,crTargetReach,missingFtd";
    return query;
  }
  if (presetKey === "country-daily") {
    query.rowDimensions = "country";
    query.metricFields = "cr,leads,ftd,crTarget,crTargetReach,missingFtd";
    return query;
  }
  if (presetKey === "benchmark") {
    query.monthKey = selectedAllMonths.join(",");
    query.includeWorkTime = "1";
    query.benchmarkMode = "1";
    query.rowDimensions = "desk,teamLeader,agent";
    query.metricFields = "ftd,agentAvgFtdPerWorkedMonth,avgFtdByDeskLongTerm,ftdBenchmarkRate";
    return query;
  }
  if (presetKey === "desk-country-cr") {
    query.columnDimension = "date";
    query.rowDimensions = "desk,country";
    query.metricFields = "ftd,crTargetReach,cr";
    return query;
  }
  if (presetKey === "country-campaign-hourly-cr") {
    query.columnDimension = "";
    query.rowDimensions = "hour,country,campaign";
    query.metricFields = "leads,ftd,cr,crTarget,crTargetReach";
    return query;
  }
  if (presetKey === "status-watch") {
    query.rowDimensions = "status";
    query.metricFields = "leadShare,leads,ftd,cr,crTarget,crTargetReach";
    return query;
  }
  if (presetKey === "comparison-report") {
    query.rowDimensions = "country,campaign,placement,subCampaign,teamLeader,agent";
    query.metricFields = "leads,ftd,cr,crTarget,crTargetReach";
    query.comparisonMode = "1";
    return query;
  }
  if (presetKey === "traffic-priority") {
    // Needs a trailing window; the backend scores the last 60 days regardless,
    // but we load a few recent months so the window is fully covered.
    query.monthKey = selectedAllMonths.slice(0, 3).join(",");
    query.trafficPriority = "1";
    query.rowDimensions = "country,campaign,agent";
    query.metricFields = "leads,ftd,cr";
    return query;
  }
  if (presetKey === "agent-productivity-plan") {
    query.monthKey = selectedAllMonths.join(",");
    query.columnDimension = "month";
    query.agentProductivityPlanMode = "1";
    query.rowDimensions = "country";
    query.metricFields = "leads,ftd,cr,crTargetReach,crTarget,ftdTarget,agentCount";
    return query;
  }
  return query;
}

async function buildSimpleQuickExportPayload({
  telegramUser,
  presetKey = "",
  office = "",
  monthKey = "",
  officeMonthFiles = [],
  now = new Date(),
}) {
  const { accessContext, allowedOffices } = await resolveTelegramOfficeContext(telegramUser);
  if (!accessContext?.authorized) {
    throw new Error("You are not authorized to request this export.");
  }
  const resolvedOffice = resolveAllowedOfficeSelection(office, allowedOffices);
  if (!resolvedOffice) {
    throw new Error("You are not authorized for the selected office.");
  }
  const officeMonthKeys = officeMonthFiles
    .map((item) => String(item?.key || "").trim())
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left));
  const query = simplePresetQuery({
    presetKey,
    office: resolvedOffice,
    monthKey,
    officeMonthKeys,
  });
  const scopeSignature = accessContext.authorityScope?.unrestricted
    ? "all"
    : JSON.stringify(accessContext.permissionFilters || {});
  const cacheKey = `simple|${presetKey}|${resolvedOffice}|${monthKey}|${officeMonthKeys.join(",")}|${scopeSignature}`;
  return getOrBuildExport(cacheKey, async () => {
    const report = await loadDashboardReport(accessContext, query, { now });
    const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
    const reportName = SIMPLE_REPORT_BY_KEY.get(presetKey)?.label || presetKey || "Report";
    const officePart = safeExportFileName(resolvedOffice || "office");
    const monthPart = safeExportFileName(monthKey || query.monthKey || "auto");
    const fileName = `${safeExportFileName(reportName)}-${officePart}-${monthPart}.xlsx`;
    const captionMonth = report?.month?.label || report?.month?.key || query.monthKey || "auto";
    return {
      workbookBuffer,
      fileName,
      caption: `${reportName}\nOffice: ${resolvedOffice || "-"} · Month: ${captionMonth}`,
    };
  });
}

function quickReportsKeyboard(session = {}, telegramUser = null) {
  const available = Array.isArray(session.availableOfficeCountries) ? session.availableOfficeCountries : [];
  return simpleOfficeKeyboard(available, telegramUser);
}

function isSettingsCallbackData(callbackData) {
  const action = String(callbackData || "").split(":")[0];
  return action === "settings" || action === "settingsRemove" || action === "settingsToggle";
}

function handleSettingsCallback(userId, callbackData, telegramUser) {
  // Only intercept Settings callbacks. Returning a response for every callback
  // would block non-admin users from the report flow (their office/report/month
  // taps would all be answered with the Settings access-denied message).
  if (!isSettingsCallbackData(callbackData)) {
    return null;
  }

  if (!isSettingsAdminTelegramUser(telegramUser)) {
    return {
      text: "Only @antoniotsd can access Settings.",
      replyMarkup: settingsKeyboard(),
    };
  }

  if (callbackData === "settings:open") {
    setSession(userId, { step: "settings_menu" });
    return { text: SETTINGS_MENU_TEXT, replyMarkup: settingsKeyboard() };
  }

  const [action, value] = String(callbackData || "").split(":");

  if (action === "settings") {
    if (value === "list") {
      return { text: formatMonthFiles(), replyMarkup: settingsKeyboard() };
    }
    if (value === "remove") {
      const records = listMonthFiles({ includeInactive: true });
      if (!records.length) {
        return { text: "No month files to remove.", replyMarkup: settingsKeyboard() };
      }
      return {
        text: "Select month to remove:",
        replyMarkup: monthActionKeyboard(records, "remove"),
      };
    }
    if (value === "visibility") {
      const records = listMonthFiles({ includeInactive: true });
      if (!records.length) {
        return { text: "No month files to update.", replyMarkup: settingsKeyboard() };
      }
      return {
        text: "Select month to hide/show:",
        replyMarkup: monthActionKeyboard(records, "toggle"),
      };
    }
    if (value === "add") {
      setSession(userId, { step: "settings_wait_month_file" });
      return {
        text: "Send month mapping as:\nMay 2026 | GOOGLE_SHEET_ID_OR_URL",
        replyMarkup: settingsKeyboard(),
      };
    }
  }

  if (action === "settingsRemove") {
    const month = getMonthFile(value, { includeInactive: true });
    if (!month) {
      return { text: "Month mapping not found.", replyMarkup: settingsKeyboard() };
    }
    removeMonthFile(value);
    return {
      text: `Removed month file: ${month.month_label}`,
      replyMarkup: settingsKeyboard(),
    };
  }

  if (action === "settingsToggle") {
    const month = getMonthFile(value, { includeInactive: true });
    if (!month) {
      return { text: "Month mapping not found.", replyMarkup: settingsKeyboard() };
    }
    const updated = setMonthFileActive(value, !month.active);
    return {
      text: `${updated.month_label} is now ${updated.active ? "Active" : "Inactive"}.`,
      replyMarkup: settingsKeyboard(),
    };
  }

  return null;
}

export async function startMenu(userId, options = {}) {
  clearSession(userId);
  if (!canUseSimpleBotReports(options)) {
    return {
      text: "Bot reports are available only for users with ALL authority in Bot Authority.",
      replyMarkup: inlineKeyboard([[{ text: "Back", callbackData: "root:start" }]]),
    };
  }
  const officeScope = await resolveOfficeScopeForStart(options).catch(() => ({
    allowedOffices: [],
  }));
  const availableOffices = [...(officeScope.allowedOffices || [])];
  if (!availableOffices.length) {
    return {
      text: "No office mapping found for your account.",
      replyMarkup: inlineKeyboard([[{ text: "Back", callbackData: "root:start" }]]),
    };
  }
  setSession(userId, {
    step: "simple_select_office",
    availableOfficeCountries: availableOffices,
    selectedOfficeCountry: "",
    selectedOfficePatterns: [],
    selectedOfficeFilters: [],
    officeMonthFiles: [],
    simpleReportKey: "",
  });
  return {
    text: OFFICE_SCOPE_TEXT,
    replyMarkup: simpleOfficeKeyboard(availableOffices, options.telegramUser),
  };
}

export async function handleMenuCallback(userId, callbackData, options = {}) {
  const now = options.now || new Date();
  const telegramUser = options.telegramUser;

  if (!canUseSimpleBotReports(options)) {
    return {
      text: "Bot reports are available only for users with ALL authority in Bot Authority.",
      replyMarkup: inlineKeyboard([[{ text: "Back", callbackData: "root:start" }]]),
    };
  }

  if (callbackData === "menu:main") {
    return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
  }

  const settingsResponse = handleSettingsCallback(userId, callbackData, telegramUser);
  if (settingsResponse) {
    return settingsResponse;
  }

  if (callbackData === "simple:office:list") {
    const session = getSession(userId);
    const available = Array.isArray(session.availableOfficeCountries) ? session.availableOfficeCountries : [];
    if (!available.length) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    setSession(userId, { step: "simple_select_office" });
    return {
      text: OFFICE_SCOPE_TEXT,
      replyMarkup: simpleOfficeKeyboard(available, telegramUser),
      editCurrentMessage: true,
    };
  }

  if (callbackData === "menu:filters" || callbackData === "simple:report:list") {
    const session = getSession(userId);
    const selectedOffice = String(session.selectedOfficeCountry || "").trim();
    if (!selectedOffice) {
      return {
        text: OFFICE_SCOPE_TEXT,
        replyMarkup: quickReportsKeyboard(session, telegramUser),
        editCurrentMessage: true,
      };
    }
    setSession(userId, { step: "simple_select_report" });
    return {
      text: `Office: ${selectedOffice}\nSelect quick report:`,
      replyMarkup: simpleReportKeyboard(selectedOffice),
      editCurrentMessage: true,
    };
  }

  if (String(callbackData || "").startsWith("simple:office:")) {
    const officeName = decodeURIComponent(String(callbackData || "").slice("simple:office:".length));
    const { allowedOffices, officeMap } = await resolveTelegramOfficeContext(telegramUser);
    const resolvedOffice = resolveAllowedOfficeSelection(officeName, allowedOffices);
    if (!resolvedOffice) {
      return {
        text: "You are not authorized for this office. Please select an allowed office.",
        replyMarkup: simpleOfficeKeyboard(allowedOffices, telegramUser),
        editCurrentMessage: true,
      };
    }
    const officeMonthFiles = officeMonthRecordsForOffice(officeMap, resolvedOffice);
    setSession(userId, {
      step: "simple_select_report",
      availableOfficeCountries: allowedOffices,
      selectedOfficeCountry: resolvedOffice,
      selectedOfficePatterns: officeCountryPatterns(officeCountryFromName(resolvedOffice)),
      selectedOfficeFilters: [],
      officeMonthFiles,
      simpleReportKey: "",
    });
    return {
      text: `Office: ${resolvedOffice}\nSelect quick report:`,
      replyMarkup: simpleReportKeyboard(resolvedOffice),
      editCurrentMessage: true,
    };
  }

  if (String(callbackData || "").startsWith("simple:report:")) {
    const presetKey = String(callbackData || "").slice("simple:report:".length);
    const preset = SIMPLE_REPORT_BY_KEY.get(presetKey);
    const session = getSession(userId);
    const selectedOffice = String(session.selectedOfficeCountry || "").trim();
    const { allowedOffices } = await resolveTelegramOfficeContext(telegramUser);
    const resolvedOffice = resolveAllowedOfficeSelection(selectedOffice, allowedOffices);
    if (!preset || !resolvedOffice) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    const officeMonthFiles = Array.isArray(session.officeMonthFiles) ? session.officeMonthFiles : [];
    if (preset.monthMode === "single") {
      if (!officeMonthFiles.length) {
        return {
          text: "No active month mapping found for selected office.",
          replyMarkup: simpleReportKeyboard(selectedOffice),
        };
      }
      setSession(userId, {
        step: "simple_select_month",
        simpleReportKey: presetKey,
      });
      return {
        text: `Office: ${selectedOffice}\nReport: ${preset.label}\n${MONTH_MENU_TEXT}`,
        replyMarkup: simpleMonthKeyboard(officeMonthFiles, presetKey),
        editCurrentMessage: true,
      };
    }
    const payload = await buildSimpleQuickExportPayload({
      telegramUser,
      presetKey,
      office: resolvedOffice,
      officeMonthFiles,
      now,
    });
    setSession(userId, {
      step: "simple_select_report",
      simpleReportKey: presetKey,
    });
    return {
      documentBuffer: payload.workbookBuffer,
      documentFilename: payload.fileName,
      documentCaption: payload.caption,
      suppressTextResponse: true,
    };
  }

  if (String(callbackData || "").startsWith("simple:month:")) {
    const [, , presetKey, selectedMonthKey] = String(callbackData || "").split(":");
    const preset = SIMPLE_REPORT_BY_KEY.get(presetKey);
    const session = getSession(userId);
    const selectedOffice = String(session.selectedOfficeCountry || "").trim();
    const { allowedOffices } = await resolveTelegramOfficeContext(telegramUser);
    const resolvedOffice = resolveAllowedOfficeSelection(selectedOffice, allowedOffices);
    const officeMonthFiles = Array.isArray(session.officeMonthFiles) ? session.officeMonthFiles : [];
    const validMonth = officeMonthFiles.some((item) => String(item?.key || "") === String(selectedMonthKey || ""));
    if (!preset || preset.monthMode !== "single" || !resolvedOffice || !validMonth) {
      return startMenu(userId, { telegramUser, authorityScope: options.authorityScope });
    }
    const payload = await buildSimpleQuickExportPayload({
      telegramUser,
      presetKey,
      office: resolvedOffice,
      monthKey: selectedMonthKey,
      officeMonthFiles,
      now,
    });
    setSession(userId, {
      step: "simple_select_report",
      simpleReportKey: presetKey,
      monthKey: selectedMonthKey,
      monthLabel: sessionMonthRecordByKey(session, selectedMonthKey, { includeInactive: true })?.month_label || selectedMonthKey,
    });
    return {
      documentBuffer: payload.workbookBuffer,
      documentFilename: payload.fileName,
      documentCaption: payload.caption,
      suppressTextResponse: true,
    };
  }

  return {
    text: "This report menu is no longer available. Please use Quick Reports.",
    replyMarkup: inlineKeyboard([[{ text: "Open Quick Reports", callbackData: "menu:main" }]]),
    editCurrentMessage: true,
  };
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  const telegramUser = options.telegramUser;

  if (!canUseSimpleBotReports(options)) {
    return {
      text: "Bot reports are available only for users with ALL authority in Bot Authority.",
      replyMarkup: inlineKeyboard([[{ text: "Back", callbackData: "root:start" }]]),
    };
  }

  if (session.step !== "settings_wait_month_file") {
    return {
      text: "Use buttons only: Office -> Quick Report -> (Month if required). Excel will download directly.",
      replyMarkup: inlineKeyboard([[{ text: "Open Quick Reports", callbackData: "menu:main" }]]),
    };
  }

  if (!isSettingsAdminTelegramUser(telegramUser)) {
    return {
      text: "Only @antoniotsd can update month mappings.",
      replyMarkup: settingsKeyboard(),
    };
  }

  const parsed = parseMonthSheetInput(text);
  if (!parsed) {
    return {
      text: "Invalid format. Send as:\nMay 2026 | GOOGLE_SHEET_ID_OR_URL",
      replyMarkup: settingsKeyboard(),
    };
  }

  try {
    const record = upsertMonthFile(parsed.month, parsed.spreadsheetId);
    setSession(userId, { step: "settings_menu" });
    return {
      text: `Saved: ${record.month_label} -> ${record.sheet_id}`,
      replyMarkup: settingsKeyboard(),
    };
  } catch (error) {
    return {
      text: `Could not save mapping: ${error.message}`,
      replyMarkup: settingsKeyboard(),
    };
  }
}
