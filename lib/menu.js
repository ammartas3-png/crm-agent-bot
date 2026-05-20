import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSelfsCount,
  calculateSummary,
  filteredRows,
  formatPercent,
  getFieldName,
  getRowValue,
  normalizeText,
  onlyDateFilters,
  parseDateValue,
  uniqueValues,
  withoutDateFilters,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import {
  currentMonthKey,
  getMonthFile,
  listMonthFiles,
  removeMonthFile,
  setMonthFileActive,
  upsertMonthFile,
} from "./monthlyReports.js";
import { isSettingsAdminTelegramUser } from "./permissions.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  agentTarget,
  buildAgentTargetsMap,
  collectAgentNames,
  formatOptionalPercent,
  formatTarget,
  summarizeTarget,
  targetReachPercent,
} from "./targets.js";

export const MAIN_MENU_TEXT = "Select report filter:";
const MONTH_MENU_TEXT = "Select report month:";
const SETTINGS_MENU_TEXT = "Settings";
const TELEGRAM_TEXT_LIMIT = 3600;

const REPORT_TYPES = {
  office: { label: "Office", fieldKey: "office" },
  teamLeader: { label: "Team Leader", fieldKey: "teamLeader" },
  agent: { label: "Agent", fieldKey: "agentNames" },
  country: { label: "Country", fieldKey: "country" },
  campaign: { label: "Campaign", fieldKey: "campaign" },
};

const HIERARCHY_NEXT = {
  office: { mode: "list", fieldKey: "teamLeader", label: "Team Leaders" },
  teamLeader: { mode: "list", fieldKey: "agentNames", label: "Agents" },
  agent: { mode: "detail", fieldKey: "agentNames", label: "Agent" },
  country: { mode: "dimension", label: "Country Breakdown" },
  campaign: { mode: "dimension", label: "Campaign Breakdown" },
};

const DIMENSION_OPTIONS = [
  { label: "By Office", fieldKey: "office" },
  { label: "By Team Leader", fieldKey: "teamLeader" },
  { label: "By Agent", fieldKey: "agentNames" },
];

export function isGreeting(text) {
  return /^(\/start|hello|hi|selam|merhaba)$/i.test(String(text || "").trim());
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

function monthKeyboard(telegramUser) {
  const monthButtons = listMonthFiles().map((month) => ({
    text: month.month_label,
    callbackData: `month:${month.key}`,
  }));
  const rows = chunkButtons(monthButtons, 2);
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

export function mainMenuKeyboard(telegramUser) {
  const rows = [
    [{ text: "Office", callbackData: "report:office" }],
    [{ text: "Team Leader", callbackData: "report:teamLeader" }],
    [{ text: "Agent", callbackData: "report:agent" }],
    [{ text: "Country", callbackData: "report:country" }],
    [{ text: "Campaign", callbackData: "report:campaign" }],
    [{ text: "Change Month", callbackData: "menu:main" }],
  ];
  if (isSettingsAdminTelegramUser(telegramUser)) {
    rows.push([{ text: SETTINGS_MENU_TEXT, callbackData: "settings:open" }]);
  }
  return inlineKeyboard(rows);
}

function settingsKeyboard() {
  return inlineKeyboard([
    [{ text: "Add / Update Month File", callbackData: "settings:add" }],
    [{ text: "List Month Files", callbackData: "settings:list" }],
    [{ text: "Remove Month File", callbackData: "settings:remove" }],
    [{ text: "Hide/Show Month File", callbackData: "settings:visibility" }],
    [{ text: "Back to Month Selection", callbackData: "menu:main" }],
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

function selectedMonthRecord(session, now = new Date()) {
  const saved = session.monthKey ? getMonthFile(session.monthKey, { includeInactive: false }) : null;
  if (saved) {
    return saved;
  }
  return getMonthFile(currentMonthKey(now), { includeInactive: false }) || listMonthFiles()[0] || null;
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

async function readReportData(readRows, tabConfig, infoAgentsTabConfig, spreadsheetId) {
  const rows = await readRows("leads", { tabConfig, spreadsheetId });
  let infoAgentRows = [];
  try {
    infoAgentRows = await readRows("infoAgents", { tabConfig: infoAgentsTabConfig, spreadsheetId });
  } catch {
    infoAgentRows = [];
  }
  return {
    rows,
    targetsMap: buildAgentTargetsMap(infoAgentRows),
  };
}

function metricLabelForField(fieldKey) {
  return (
    {
      office: "Office",
      teamLeader: "Team Leader",
      agentNames: "Agent",
      country: "Country",
      campaign: "Campaign",
    }[fieldKey] || "Result"
  );
}

function targetForSummary(summary, groupField, selectedLabel, tabConfig, targetsMap) {
  if (groupField === "agentNames") {
    return agentTarget(targetsMap, selectedLabel);
  }
  return summarizeTarget(collectAgentNames(summary.contextRows || [], tabConfig), targetsMap);
}

function metricPayload(summary, groupField, selectedLabel, tabConfig, targetsMap) {
  const ftdTarget = targetForSummary(summary, groupField, selectedLabel, tabConfig, targetsMap);
  const ftdTargetReach = targetReachPercent(summary.totalFtd, ftdTarget);
  const selfs = calculateSelfsCount(summary.ftdRows || [], tabConfig);
  return {
    lead: summary.totalLeads,
    ftd: summary.totalFtd,
    cr: summary.cr,
    selfs,
    lateFtd: summary.lateFtd,
    crTarget: summary.crTarget,
    crTargetReach: summary.crTargetReach,
    ftdTarget,
    ftdTargetReach,
  };
}

function formatMetricLine(label, metrics) {
  return [
    `${label}`,
    `Lead ${metrics.lead.toLocaleString("en-US")}`,
    `FTD ${metrics.ftd.toLocaleString("en-US")}`,
    `CR ${formatPercent(metrics.cr)}`,
    `Selfs ${metrics.selfs.toLocaleString("en-US")}`,
    `Late FTD ${metrics.lateFtd.toLocaleString("en-US")}`,
    `CR Target ${formatPercent(metrics.crTarget)}`,
    `CR Target Reach ${formatPercent(metrics.crTargetReach)}`,
    `FTD Target ${formatTarget(metrics.ftdTarget)}`,
    `FTD Target Reach ${formatOptionalPercent(metrics.ftdTargetReach)}`,
  ].join(" | ");
}

function formatMetricBlock(title, metrics) {
  return [
    title,
    `Lead: ${metrics.lead.toLocaleString("en-US")}`,
    `FTD: ${metrics.ftd.toLocaleString("en-US")}`,
    `CR: ${formatPercent(metrics.cr)}`,
    `Selfs: ${metrics.selfs.toLocaleString("en-US")}`,
    `Late FTD: ${metrics.lateFtd.toLocaleString("en-US")}`,
    `CR Target: ${formatPercent(metrics.crTarget)}`,
    `CR Target Reach: ${formatPercent(metrics.crTargetReach)}`,
    `FTD Target: ${formatTarget(metrics.ftdTarget)}`,
    `FTD Target Reach: ${formatOptionalPercent(metrics.ftdTargetReach)}`,
  ].join("\n");
}

function fieldToFilterKey(fieldKey) {
  return (
    {
      office: "office",
      teamLeader: "teamLeader",
      agentNames: "agent",
      country: "country",
      campaign: "campaign",
    }[fieldKey] || fieldKey
  );
}

function applyFieldFilter(filters, fieldKey, value) {
  const next = { ...filters };
  const filterKey = fieldToFilterKey(fieldKey);
  next[filterKey] = value;
  if (fieldKey === "agentNames") {
    next.agentField = "agentNames";
  }
  return next;
}

function buildGroupItems(rows, tabConfig, baseFilters, groupField, targetsMap, now = new Date()) {
  const fieldName = getFieldName(tabConfig, groupField);
  const rowsWithoutDate = filteredRows(rows, tabConfig, withoutDateFilters(baseFilters), now);
  const groups = new Map();
  for (const row of rowsWithoutDate) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (!label) {
      continue;
    }
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(row);
  }

  const dateFilters = onlyDateFilters(baseFilters);
  return [...groups.entries()]
    .map(([label, groupRows]) => {
      const summary = calculateSummary(groupRows, tabConfig, dateFilters, now);
      return {
        label,
        summary,
        metrics: metricPayload(summary, groupField, label, tabConfig, targetsMap),
      };
    })
    .sort(
      (left, right) =>
        right.summary.totalFtd - left.summary.totalFtd ||
        right.summary.cr - left.summary.cr ||
        right.summary.totalLeads - left.summary.totalLeads,
    );
}

function paginateItems(items, page, firstItemLimit = 10) {
  if (!items.length) {
    return { page: 0, totalPages: 1, start: 0, chunk: [] };
  }
  const totalPages = Math.max(1, Math.ceil(items.length / firstItemLimit));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * firstItemLimit;
  const chunk = items.slice(start, start + firstItemLimit);
  return { page: safePage, totalPages, start, chunk };
}

function buildListKeyboard(view, pageChunk, start, page, totalPages) {
  const rows = chunkButtons(
    pageChunk.map((item, index) => ({
      text: item.label,
      callbackData: `drill:pick:${start + index}`,
    })),
    2,
  );

  if (view.dimensionOptions?.length) {
    rows.push(
      view.dimensionOptions.map((option) => ({
        text: option.label,
        callbackData: `drill:dimension:${option.fieldKey}`,
      })),
    );
  }

  if (totalPages > 1) {
    rows.push([
      { text: "Previous Page", callbackData: `drill:page:${Math.max(page - 1, 0)}` },
      { text: "Next Page", callbackData: `drill:page:${Math.min(page + 1, totalPages - 1)}` },
    ]);
  }

  if (view.backStack?.length) {
    rows.push([{ text: "Back to previous level", callbackData: "drill:back" }]);
  }

  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function buildDetailKeyboard(view, rootType) {
  const rows = [];
  if (view.backStack?.length) {
    rows.push([{ text: "Back to previous level", callbackData: "drill:back" }]);
  }
  if (rootType === "agent") {
    rows.push([
      { text: "Back to Team Leader filter", callbackData: "report:teamLeader" },
      { text: "Back to Office filter", callbackData: "report:office" },
    ]);
  }
  rows.push([{ text: "Back to Report Filters", callbackData: "menu:filters" }]);
  rows.push([{ text: "Change Month", callbackData: "menu:main" }]);
  return inlineKeyboard(rows);
}

function renderListView(view, rows, tabConfig, targetsMap, now = new Date()) {
  const items = buildGroupItems(rows, tabConfig, view.baseFilters, view.groupField, targetsMap, now);
  const { page, totalPages, start, chunk } = paginateItems(items, view.page || 0, 8);

  if (!items.length) {
    return {
      text: `${view.title}\nNo data found.`,
      replyMarkup: buildListKeyboard({ ...view, backStack: view.backStack || [] }, [], 0, 0, 1),
      nextView: { ...view, page: 0 },
    };
  }

  const totalSummary = calculateSummary(rows, tabConfig, view.baseFilters, now);
  const totalMetrics = metricPayload(
    totalSummary,
    view.groupField,
    metricLabelForField(view.groupField),
    tabConfig,
    targetsMap,
  );

  const lines = [
    view.title,
    `Page ${page + 1}/${totalPages}`,
    "",
    formatMetricLine("Summary (all records)", totalMetrics),
    "",
    ...chunk.map((item, index) => formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics)),
  ];

  let text = lines.join("\n");
  if (text.length > TELEGRAM_TEXT_LIMIT) {
    // Keep response concise and page further if labels are long.
    const compactChunk = chunk.slice(0, Math.max(1, Math.floor(chunk.length / 2)));
    const compactLines = [
      view.title,
      `Page ${page + 1}/${totalPages}`,
      "",
      formatMetricLine("Summary (all records)", totalMetrics),
      "",
      ...compactChunk.map((item, index) => formatMetricLine(`${start + index + 1}. ${item.label}`, item.metrics)),
    ];
    text = compactLines.join("\n");
  }

  return {
    text,
    replyMarkup: buildListKeyboard(view, chunk, start, page, totalPages),
    nextView: { ...view, page },
    items,
  };
}

function renderDetailView(view, rows, tabConfig, targetsMap, now = new Date()) {
  const summary = calculateSummary(rows, tabConfig, view.filters, now);
  const metrics = metricPayload(summary, view.groupField, view.selectedLabel, tabConfig, targetsMap);
  return {
    text: formatMetricBlock(view.title, metrics),
    replyMarkup: buildDetailKeyboard(view, view.rootType),
    nextView: view,
  };
}

function createRootView(reportType, monthLabel) {
  const root = REPORT_TYPES[reportType];
  const next = HIERARCHY_NEXT[reportType];
  return {
    mode: "list",
    rootType: reportType,
    title: `${root.label} Results — ${monthLabel}`,
    groupField: root.fieldKey,
    baseFilters: {},
    page: 0,
    nextMode: next,
    backStack: [],
  };
}

function createListView({
  rootType,
  title,
  groupField,
  baseFilters,
  backStack,
  nextMode,
  dimensionOptions = null,
  parentField = null,
  parentLabel = null,
}) {
  return {
    mode: "list",
    rootType,
    title,
    groupField,
    baseFilters,
    page: 0,
    nextMode,
    backStack,
    dimensionOptions,
    parentField,
    parentLabel,
  };
}

export async function startMenu(userId, options = {}) {
  clearSession(userId);
  setSession(userId, { step: "select_month" });
  return {
    text: MONTH_MENU_TEXT,
    replyMarkup: monthKeyboard(options.telegramUser),
  };
}

function renderHierarchy(session, rows, tabConfig, targetsMap, now) {
  if (session.view?.mode === "detail") {
    return renderDetailView(session.view, rows, tabConfig, targetsMap, now);
  }
  return renderListView(session.view, rows, tabConfig, targetsMap, now);
}

function monthToSession(month, now = new Date()) {
  return {
    monthKey: month.key,
    monthLabel: month.month_label,
    spreadsheetId: month.sheet_id,
    isHistorical: month.key < currentMonthKey(now),
  };
}

export async function handleMenuCallback(userId, callbackData, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const readRows = options.readRows || readSheetRows;
  const now = options.now || new Date();
  const telegramUser = options.telegramUser;

  if (callbackData === "menu:main") {
    return startMenu(userId, { telegramUser });
  }

  if (callbackData === "menu:filters") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      ...monthToSession(month, now),
      step: "select_report_type",
      view: null,
    });
    return {
      text: `Month: ${month.month_label}\n${MAIN_MENU_TEXT}`,
      replyMarkup: mainMenuKeyboard(telegramUser),
    };
  }

  const [action, value, extra] = String(callbackData || "").split(":");

  if (action === "month") {
    const month = getMonthFile(value, { includeInactive: false });
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    setSession(userId, {
      ...monthToSession(month, now),
      step: "select_report_type",
      view: null,
    });
    return {
      text: `Month: ${month.month_label}\n${MAIN_MENU_TEXT}`,
      replyMarkup: mainMenuKeyboard(telegramUser),
    };
  }

  if (action === "settings") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can access Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
    if (value === "open") {
      setSession(userId, { step: "settings_menu" });
      return { text: SETTINGS_MENU_TEXT, replyMarkup: settingsKeyboard() };
    }
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
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can manage month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
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
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can manage month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }
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

  if (action === "report") {
    const reportType = REPORT_TYPES[value];
    if (!reportType) {
      return startMenu(userId, { telegramUser });
    }
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return {
        text: "No month files configured. Ask @antoniotsd to add one in Settings.",
        replyMarkup: monthKeyboard(telegramUser),
      };
    }

    const { rows, targetsMap } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
    );
    const view = createRootView(value, month.month_label);
    const rendered = renderListView(view, rows, tabConfig, targetsMap, now);
    setSession(userId, {
      ...monthToSession(month, now),
      step: "report_ready",
      reportType: value,
      view: rendered.nextView,
    });
    return {
      text: rendered.text,
      replyMarkup: rendered.replyMarkup,
    };
  }

  if (action === "drill") {
    const session = getSession(userId);
    const month = selectedMonthRecord(session, now);
    if (!month) {
      return startMenu(userId, { telegramUser });
    }
    const { rows, targetsMap } = await readReportData(
      readRows,
      tabConfig,
      infoAgentsTabConfig,
      month.sheet_id,
    );
    let view = session.view;
    if (!view) {
      return {
        text: `Month: ${month.month_label}\n${MAIN_MENU_TEXT}`,
        replyMarkup: mainMenuKeyboard(telegramUser),
      };
    }

    if (value === "page") {
      view = { ...view, page: Number(extra) || 0 };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "back") {
      if (!view.backStack?.length) {
        return {
          text: `Month: ${month.month_label}\n${MAIN_MENU_TEXT}`,
          replyMarkup: mainMenuKeyboard(telegramUser),
        };
      }
      const previous = view.backStack[view.backStack.length - 1];
      const rendered = previous.mode === "detail"
        ? renderDetailView(previous, rows, tabConfig, targetsMap, now)
        : renderListView(previous, rows, tabConfig, targetsMap, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "dimension" && view.mode === "list" && view.dimensionOptions?.length) {
      const fieldKey = extra;
      if (!DIMENSION_OPTIONS.some((option) => option.fieldKey === fieldKey)) {
        return { text: "Unknown dimension.", replyMarkup: mainMenuKeyboard(telegramUser) };
      }
      view = {
        ...view,
        groupField: fieldKey,
        page: 0,
        nextMode: { mode: "detail", fieldKey, label: metricLabelForField(fieldKey) },
      };
      const rendered = renderListView(view, rows, tabConfig, targetsMap, now);
      setSession(userId, { view: rendered.nextView });
      return { text: rendered.text, replyMarkup: rendered.replyMarkup };
    }

    if (value === "pick" && view.mode === "list") {
      const pickedIndex = Number(extra);
      const rendered = renderListView(view, rows, tabConfig, targetsMap, now);
      const items = rendered.items || [];
      const picked = items[pickedIndex];
      if (!picked) {
        return { text: rendered.text, replyMarkup: rendered.replyMarkup };
      }

      const nextMode = view.nextMode || { mode: "detail", fieldKey: view.groupField };
      const backStack = [...(view.backStack || []), rendered.nextView];
      if (nextMode.mode === "detail") {
        const filters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const detailView = {
          mode: "detail",
          rootType: view.rootType,
          title: `${metricLabelForField(view.groupField)}: ${picked.label}`,
          groupField: view.groupField,
          selectedLabel: picked.label,
          filters,
          backStack,
        };
        const detail = renderDetailView(detailView, rows, tabConfig, targetsMap, now);
        setSession(userId, { view: detail.nextView });
        return { text: detail.text, replyMarkup: detail.replyMarkup };
      }

      if (nextMode.mode === "dimension") {
        const parentFilters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const breakdownView = createListView({
          rootType: view.rootType,
          title: `${metricLabelForField(view.groupField)}: ${picked.label} — By Office`,
          groupField: "office",
          baseFilters: parentFilters,
          backStack,
          nextMode: { mode: "detail", fieldKey: "office", label: "Office" },
          dimensionOptions: DIMENSION_OPTIONS,
          parentField: view.groupField,
          parentLabel: picked.label,
        });
        const list = renderListView(breakdownView, rows, tabConfig, targetsMap, now);
        setSession(userId, { view: list.nextView });
        return { text: list.text, replyMarkup: list.replyMarkup };
      }

      if (nextMode.mode === "list") {
        const nextFilters = applyFieldFilter(view.baseFilters, view.groupField, picked.label);
        const nextView = createListView({
          rootType: view.rootType,
          title: `${nextMode.label} in ${picked.label}`,
          groupField: nextMode.fieldKey,
          baseFilters: nextFilters,
          backStack,
          nextMode:
            nextMode.fieldKey === "agentNames"
              ? { mode: "detail", fieldKey: "agentNames", label: "Agent" }
              : { mode: "detail", fieldKey: nextMode.fieldKey, label: nextMode.label },
        });
        const list = renderListView(nextView, rows, tabConfig, targetsMap, now);
        setSession(userId, { view: list.nextView });
        return { text: list.text, replyMarkup: list.replyMarkup };
      }
    }
  }

  return startMenu(userId, { telegramUser });
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  const telegramUser = options.telegramUser;
  if (session.step === "settings_wait_month_file") {
    if (!isSettingsAdminTelegramUser(telegramUser)) {
      return {
        text: "Only @antoniotsd can update month mappings.",
        replyMarkup: monthKeyboard(telegramUser),
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

  if (session.step !== "custom_date_range") {
    return null;
  }

  const customRange = String(text || "").trim();
  const parts = customRange.split(/\s+(?:to|-|–|—)\s+/i).map((part) => part.trim());
  if (parts.length !== 2 || !parseDateValue(parts[0]) || !parseDateValue(parts[1])) {
    return {
      text: "Invalid range. Please send it as:\nDD/MM/YYYY - DD/MM/YYYY",
      replyMarkup: inlineKeyboard([[{ text: "Back to Report Filters", callbackData: "menu:filters" }]]),
    };
  }
  return {
    text: "Date-range custom flow is deprecated in hierarchical navigation. Use report filters directly.",
    replyMarkup: inlineKeyboard([[{ text: "Back to Report Filters", callbackData: "menu:filters" }]]),
  };
}

export function formatTopPerformers() {
  return "Top performers are now available through full hierarchical report navigation.";
}

export function formatBreakdown() {
  return "Breakdown view moved to hierarchical drilldown navigation.";
}
