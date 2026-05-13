import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  createDateRangeFilter,
  formatPercent,
  generateReport,
  groupPerformance,
  hourlyDistribution,
  statusDistribution,
  uniqueValues,
  parseDateValue,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { clearSession, getSession, setSession } from "./session.js";

export const MAIN_MENU_TEXT = "Select a report type:";

const REPORT_TYPES = {
  country: {
    label: "Country",
    title: "Country Report",
    fieldKey: "country",
    filterKey: "country",
    breakdowns: [
      ["Top Agents", "topAgents"],
      ["Campaign Breakdown", "campaignBreakdown"],
      ["Hourly Breakdown", "hourlyBreakdown"],
    ],
  },
  office: {
    label: "Office",
    title: "Office Report",
    fieldKey: "office",
    filterKey: "office",
    breakdowns: [
      ["Top Agents", "topAgents"],
      ["Country Breakdown", "countryBreakdown"],
      ["Top Team Leaders", "teamLeaderBreakdown"],
    ],
  },
  teamLeader: {
    label: "Team Leader",
    title: "Team Leader Report",
    fieldKey: "teamLeader",
    filterKey: "teamLeader",
    breakdowns: [["Agents", "agentPerformance"]],
  },
  agent: {
    label: "Agent",
    title: "Agent Report",
    fieldKey: "agentNames",
    filterKey: "agent",
    filterExtra: { agentField: "agentNames" },
    breakdowns: [
      ["Status Distribution", "statusDistribution"],
      ["Country Breakdown", "countryBreakdown"],
      ["Campaign Breakdown", "campaignBreakdown"],
    ],
  },
  brand: {
    label: "Brand",
    title: "Brand Report",
    fieldKey: "brand",
    filterKey: "brand",
    breakdowns: [
      ["Country Breakdown", "countryBreakdown"],
      ["Top Agents", "topAgents"],
      ["Campaign Breakdown", "campaignBreakdown"],
    ],
  },
  campaign: {
    label: "Campaign",
    title: "Campaign Report",
    fieldKey: "campaign",
    filterKey: "campaign",
    breakdowns: [
      ["Country Breakdown", "countryBreakdown"],
      ["Top Agents", "topAgents"],
      ["Placement Breakdown", "placementBreakdown"],
    ],
  },
};

const DATE_RANGE_OPTIONS = [
  ["Today", "today"],
  ["Yesterday", "yesterday"],
  ["This Month", "thisMonth"],
  ["Last Month", "lastMonth"],
  ["Custom Range", "custom"],
  ["All Data", "all"],
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

export function mainMenuKeyboard() {
  return inlineKeyboard([
    [
      { text: "Report by Country", callbackData: "report:country" },
      { text: "Report by Office", callbackData: "report:office" },
    ],
    [
      { text: "Report by Team Leader", callbackData: "report:teamLeader" },
      { text: "Report by Agent", callbackData: "report:agent" },
    ],
    [
      { text: "Report by Brand", callbackData: "report:brand" },
      { text: "Report by Campaign", callbackData: "report:campaign" },
    ],
    [
      { text: "Date / Hour Analysis", callbackData: "quick:hourly" },
      { text: "Top Performers", callbackData: "quick:topPerformers" },
    ],
    [{ text: "Status Distribution", callbackData: "quick:statusDistribution" }],
  ]);
}

export function valueKeyboard(values) {
  const buttons = values.map((value, index) => ({
    text: value,
    callbackData: `value:${index}`,
  }));
  buttons.push({ text: "Back to Main Menu", callbackData: "menu:main" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

export function dateRangeKeyboard() {
  return inlineKeyboard([
    [
      { text: "Today", callbackData: "date:today" },
      { text: "Yesterday", callbackData: "date:yesterday" },
    ],
    [
      { text: "This Month", callbackData: "date:thisMonth" },
      { text: "Last Month", callbackData: "date:lastMonth" },
    ],
    [
      { text: "Custom Range", callbackData: "date:custom" },
      { text: "All Data", callbackData: "date:all" },
    ],
    [{ text: "Back to Main Menu", callbackData: "menu:main" }],
  ]);
}

export function postReportKeyboard(reportType) {
  const buttons = (REPORT_TYPES[reportType]?.breakdowns || [
    ["Top Agents", "topAgents"],
    ["Campaign Breakdown", "campaignBreakdown"],
    ["Hourly Breakdown", "hourlyBreakdown"],
  ]).map(([label, key]) => ({
    text: label,
    callbackData: `breakdown:${key}`,
  }));
  buttons.push({ text: "Back to Main Menu", callbackData: "menu:main" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

function dateRangeByKey(key, now) {
  if (key === "all") {
    return { key, label: "All Data", filter: null };
  }
  if (key === "custom") {
    return { key, label: "Custom Range", filter: null, unsupported: true };
  }
  const range = createDateRangeFilter(key, now);
  return range ? { key, ...range } : { key: "all", label: "All Data", filter: null };
}

function parseCustomDateRange(text) {
  const parts = String(text || "")
    .split(/\s+(?:to|-|–|—)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  const start = parseDateValue(parts[0]);
  const end = parseDateValue(parts[1]);
  if (!start || !end) {
    return null;
  }
  return {
    key: "custom",
    label: `${parts[0]} - ${parts[1]}`,
    filter: {
      type: "range",
      start: parts[0],
      end: parts[1],
    },
  };
}

function buildFilters(session) {
  const reportType = REPORT_TYPES[session.reportType];
  const filters = {};
  if (reportType?.filterKey && session.selectedValue) {
    filters[reportType.filterKey] = session.selectedValue;
  }
  if (reportType?.filterExtra) {
    Object.assign(filters, reportType.filterExtra);
  }
  if (session.dateRange?.filter) {
    filters.date = session.dateRange.filter;
  }
  return filters;
}

function reportTitle(session) {
  const reportType = REPORT_TYPES[session.reportType];
  if (!reportType) {
    return "CRM Report";
  }
  return `${session.selectedValue} ${reportType.title}`;
}

function formatSummary(title, dateRangeLabel, summary) {
  return [
    title,
    `Date Range: ${dateRangeLabel}`,
    "",
    `Total Leads: ${summary.totalLeads.toLocaleString("en-US")}`,
    `Valid Leads: ${summary.validLeads.toLocaleString("en-US")}`,
    `Total FTD: ${summary.totalFtd.toLocaleString("en-US")}`,
    `Late FTD: ${summary.lateFtd.toLocaleString("en-US")}`,
    `CR: ${formatPercent(summary.cr)}`,
    `CR Target: ${formatPercent(summary.crTarget)}`,
    `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
    "",
    "Debug:",
    `leadRowsByLeadDate: ${summary.leadRowsByLeadDate.toLocaleString("en-US")}`,
    `ftdRowsByFtdDate: ${summary.ftdRowsByFtdDate.toLocaleString("en-US")}`,
    `totalLeads: ${summary.totalLeads.toLocaleString("en-US")}`,
    `totalFtd: ${summary.totalFtd.toLocaleString("en-US")}`,
    `cr: ${formatPercent(summary.cr)}`,
  ].join("\n");
}

function formatPerformanceList(title, items, suffix = "FTD") {
  if (!items.length) {
    return `${title}\nNo data found.`;
  }
  return [
    title,
    ...items.map(
      (item, index) =>
        `${index + 1}. ${item.label} — ${item.summary.totalFtd.toLocaleString("en-US")} ${suffix} / CR ${formatPercent(item.summary.cr)}`,
    ),
  ].join("\n");
}

function formatStatusDistribution(rows, tabConfig, filters, now) {
  const items = statusDistribution(rows, tabConfig, filters, now);
  if (!items.length) {
    return "Status Distribution\nNo data found.";
  }
  return [
    "Status Distribution",
    ...items.map(
      (item) =>
        `${item.label}: ${item.value.toLocaleString("en-US")} (${formatPercent(item.percentage)})`,
    ),
  ].join("\n");
}

function formatHourlyReport(rows, tabConfig, filters, now) {
  const items = hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now);
  if (!items.length) {
    return "Hourly Report\nNo data found.";
  }
  return [
    "Hourly Report",
    ...items.map(
      (item) =>
        `${item.label} — Leads ${item.leads.toLocaleString("en-US")} / FTD ${item.ftd.toLocaleString("en-US")} / CR ${formatPercent(item.cr)}`,
    ),
  ].join("\n");
}

function fieldForBreakdown(key) {
  return {
    topAgents: "agentNames",
    agentPerformance: "agentNames",
    campaignBreakdown: "campaign",
    countryBreakdown: "country",
    teamLeaderBreakdown: "teamLeader",
    placementBreakdown: "placement",
  }[key];
}

export function formatBreakdown(key, session, rows, tabConfig, now = new Date()) {
  const filters = buildFilters(session);
  if (key === "statusDistribution") {
    return formatStatusDistribution(rows, tabConfig, filters, now);
  }
  if (key === "hourlyBreakdown" || key === "hourly") {
    return formatHourlyReport(rows, tabConfig, filters, now);
  }

  const fieldKey = fieldForBreakdown(key) || "agentNames";
  const title = {
    topAgents: "Top Agents by FTD",
    agentPerformance: "Agents by FTD and CR",
    campaignBreakdown: "Campaign Breakdown",
    countryBreakdown: "Country Breakdown",
    teamLeaderBreakdown: "Team Leader Breakdown",
    placementBreakdown: "Placement Breakdown",
  }[key] || "Breakdown";

  return formatPerformanceList(
    title,
    groupPerformance(rows, tabConfig, filters, fieldKey, 5, "totalFtd", now),
  );
}

export function formatTopPerformers(rows, tabConfig, now = new Date(), filters = {}, dateRangeLabel = "All Data") {
  return [
    "Top Performers",
    `Date Range: ${dateRangeLabel}`,
    "",
    formatPerformanceList(
      "Top 10 Agents by FTD",
      groupPerformance(rows, tabConfig, filters, "agentNames", 10, "totalFtd", now),
    ),
    "",
    formatPerformanceList(
      "Top 10 Agents by CR (min 20 valid leads)",
      groupPerformance(rows, tabConfig, filters, "agentNames", 10, "cr", now, { minValidLeads: 20 }),
      "FTD",
    ),
    "",
    formatPerformanceList(
      "Top 10 Team Leaders by FTD",
      groupPerformance(rows, tabConfig, filters, "teamLeader", 10, "totalFtd", now),
    ),
    "",
    formatPerformanceList(
      "Top 10 Campaigns by FTD",
      groupPerformance(rows, tabConfig, filters, "campaign", 10, "totalFtd", now),
    ),
    "",
    formatPerformanceList(
      "Top 10 Countries by CR",
      groupPerformance(rows, tabConfig, filters, "country", 10, "cr", now),
    ),
  ].join("\n");
}

export function formatReport(session, rows, tabConfig, now = new Date()) {
  const reportType = REPORT_TYPES[session.reportType];
  const report = generateReport({
    rows,
    tabConfig,
    groupField: reportType?.filterKey,
    selectedValue: session.selectedValue,
    dateRange: session.dateRange,
    now,
  });
  if (reportType?.filterExtra) {
    Object.assign(report.filters, reportType.filterExtra);
    report.summary = calculateSummary(rows, tabConfig, report.filters, now);
  }
  return formatSummary(reportTitle(session), report.dateRangeLabel, report.summary);
}

export async function startMenu(userId) {
  clearSession(userId);
  return {
    text: MAIN_MENU_TEXT,
    replyMarkup: mainMenuKeyboard(),
  };
}

export async function handleMenuCallback(userId, callbackData, options = {}) {
  const tabConfig = options.tabConfig || getTabConfig("leads");
  const readRows = options.readRows || readSheetRows;
  const now = options.now || new Date();

  if (callbackData === "menu:main") {
    return startMenu(userId);
  }

  const [action, value] = String(callbackData || "").split(":");

  if (action === "report") {
    const reportType = REPORT_TYPES[value];
    if (!reportType) {
      return startMenu(userId);
    }
    const rows = await readRows("leads", { tabConfig });
    const values = uniqueValues(rows, tabConfig, reportType.fieldKey);
    setSession(userId, {
      reportType: value,
      options: values,
      selectedValue: null,
      dateRange: null,
      step: "select_value",
    });
    return {
      text: values.length
        ? `Select ${reportType.label.toLowerCase()}:`
        : `No ${reportType.label.toLowerCase()} values found in the sheet.`,
      replyMarkup: valueKeyboard(values),
    };
  }

  if (action === "value") {
    const session = getSession(userId);
    const selectedValue = session.options?.[Number(value)];
    if (!selectedValue) {
      return startMenu(userId);
    }
    setSession(userId, {
      selectedValue,
      step: "select_date",
    });
    const reportType = REPORT_TYPES[session.reportType];
    return {
      text: `${reportType?.label || "Filter"}: ${selectedValue}\nSelect date range:`,
      replyMarkup: dateRangeKeyboard(),
    };
  }

  if (action === "date") {
    const session = getSession(userId);
    const dateRange = dateRangeByKey(value, now);
    if (dateRange.unsupported) {
      setSession(userId, {
        step: "custom_date_range",
      });
      return {
        text: "Send custom date range as:\nDD/MM/YYYY - DD/MM/YYYY",
        replyMarkup: inlineKeyboard([[{ text: "Back to Main Menu", callbackData: "menu:main" }]]),
      };
    }
    const nextSession = setSession(userId, {
      dateRange,
      step: "report_ready",
    });
    const rows = await readRows("leads", { tabConfig });
    if (nextSession.quickType) {
      const filters = dateRange.filter ? { date: dateRange.filter } : {};
      if (nextSession.quickType === "topPerformers") {
        return {
          text: formatTopPerformers(
            rows.filter(() => true),
            tabConfig,
            now,
            filters,
            dateRange.label,
          ),
          replyMarkup: mainMenuKeyboard(),
        };
      }
      if (nextSession.quickType === "statusDistribution") {
        return {
          text: [`Status Distribution`, `Date Range: ${dateRange.label}`, "", formatStatusDistribution(rows, tabConfig, filters, now)]
            .filter(Boolean)
            .join("\n"),
          replyMarkup: mainMenuKeyboard(),
        };
      }
      if (nextSession.quickType === "hourly") {
        return {
          text: [`Date / Hour Analysis`, `Date Range: ${dateRange.label}`, "", formatHourlyReport(rows, tabConfig, filters, now)]
            .filter(Boolean)
            .join("\n"),
          replyMarkup: mainMenuKeyboard(),
        };
      }
    }
    return {
      text: formatReport(nextSession, rows, tabConfig, now),
      replyMarkup: postReportKeyboard(nextSession.reportType),
    };
  }

  if (action === "breakdown") {
    const session = getSession(userId);
    const rows = await readRows("leads", { tabConfig });
    return {
      text: formatBreakdown(value, session, rows, tabConfig, now),
      replyMarkup: postReportKeyboard(session.reportType),
    };
  }

  if (action === "quick") {
    setSession(userId, {
      quickType: value,
      reportType: null,
      selectedValue: null,
      dateRange: null,
      step: "select_date",
    });
    return {
      text: "Select date range:",
      replyMarkup: dateRangeKeyboard(),
    };
  }

  return startMenu(userId);
}

export async function handleMenuText(userId, text, options = {}) {
  const session = getSession(userId);
  if (session.step !== "custom_date_range") {
    return null;
  }

  const tabConfig = options.tabConfig || getTabConfig("leads");
  const readRows = options.readRows || readSheetRows;
  const now = options.now || new Date();
  const dateRange = parseCustomDateRange(text);
  if (!dateRange) {
    return {
      text: "Invalid range. Please send it as:\nDD/MM/YYYY - DD/MM/YYYY",
      replyMarkup: inlineKeyboard([[{ text: "Back to Main Menu", callbackData: "menu:main" }]]),
    };
  }

  const nextSession = setSession(userId, {
    dateRange,
    step: "report_ready",
  });
  const rows = await readRows("leads", { tabConfig });

  if (nextSession.quickType) {
    const filters = dateRange.filter ? { date: dateRange.filter } : {};
    if (nextSession.quickType === "topPerformers") {
      return {
        text: formatTopPerformers(rows, tabConfig, now, filters, dateRange.label),
        replyMarkup: mainMenuKeyboard(),
      };
    }
    if (nextSession.quickType === "statusDistribution") {
      return {
        text: [`Status Distribution`, `Date Range: ${dateRange.label}`, "", formatStatusDistribution(rows, tabConfig, filters, now)]
          .filter(Boolean)
          .join("\n"),
        replyMarkup: mainMenuKeyboard(),
      };
    }
    return {
      text: [`Date / Hour Analysis`, `Date Range: ${dateRange.label}`, "", formatHourlyReport(rows, tabConfig, filters, now)]
        .filter(Boolean)
        .join("\n"),
      replyMarkup: mainMenuKeyboard(),
    };
  }

  return {
    text: formatReport(nextSession, rows, tabConfig, now),
    replyMarkup: postReportKeyboard(nextSession.reportType),
  };
}
