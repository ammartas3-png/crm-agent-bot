import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  formatPercent,
  hourlyDistribution,
  statusDistribution,
  topPerformers,
  uniqueValues,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { clearSession, getSession, setSession } from "./session.js";

export const MAIN_MENU_TEXT = "Select a report type:";

const DIMENSIONS = {
  country: { label: "Country", fieldKey: "country", filterKey: "country" },
  office: { label: "Office", fieldKey: "office", filterKey: "office" },
  teamLeader: { label: "Team Leader", fieldKey: "teamLeader", filterKey: "teamLeader" },
  agent: { label: "Agent", fieldKey: "agentNames", filterKey: "agent" },
  brand: { label: "Brand", fieldKey: "brand", filterKey: "brand" },
  campaign: { label: "Campaign", fieldKey: "campaign", filterKey: "campaign" },
};

const COUNTRY_METRICS = [
  ["Total Leads", "totalLeads"],
  ["Total FTD", "totalFtd"],
  ["CR", "cr"],
  ["CR Target Reach", "crTargetReach"],
  ["Late FTD", "lateFtd"],
  ["Status Distribution", "statusDistribution"],
  ["Top Agents", "topAgents"],
];

const AGENT_METRICS = [
  ["Total Leads", "totalLeads"],
  ["Total FTD", "totalFtd"],
  ["CR", "cr"],
  ["Late FTD", "lateFtd"],
  ["Status Distribution", "statusDistribution"],
  ["Hourly Performance", "hourlyPerformance"],
];

const DEFAULT_METRICS = [
  ["Summary", "summary"],
  ["Total Leads", "totalLeads"],
  ["Total FTD", "totalFtd"],
  ["CR", "cr"],
  ["Status Distribution", "statusDistribution"],
  ["Top Performers", "topPerformers"],
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
      { text: "Report by Country", callbackData: "dim:country" },
      { text: "Report by Office", callbackData: "dim:office" },
    ],
    [
      { text: "Report by Team Leader", callbackData: "dim:teamLeader" },
      { text: "Report by Agent", callbackData: "dim:agent" },
    ],
    [
      { text: "Report by Brand", callbackData: "dim:brand" },
      { text: "Report by Campaign", callbackData: "dim:campaign" },
    ],
    [
      { text: "Date / Hour Analysis", callbackData: "quick:hourlyPerformance" },
      { text: "Top Performers", callbackData: "quick:topAgents" },
    ],
    [{ text: "Status Distribution", callbackData: "quick:statusDistribution" }],
  ]);
}

export function metricKeyboard(dimension) {
  const metrics =
    dimension === "country" ? COUNTRY_METRICS : dimension === "agent" ? AGENT_METRICS : DEFAULT_METRICS;
  const buttons = metrics.map(([label, metric]) => ({
    text: label,
    callbackData: `metric:${metric}`,
  }));
  buttons.push({ text: "Main Menu", callbackData: "menu:main" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

export function valueKeyboard(values) {
  const buttons = values.map((value, index) => ({
    text: value,
    callbackData: `value:${index}`,
  }));
  buttons.push({ text: "Main Menu", callbackData: "menu:main" });
  return inlineKeyboard(chunkButtons(buttons, 2));
}

function dimensionLabel(dimension) {
  return DIMENSIONS[dimension]?.label || "Filter";
}

function metricLabel(metric) {
  return (
    [...COUNTRY_METRICS, ...AGENT_METRICS, ...DEFAULT_METRICS].find(([, key]) => key === metric)?.[0] ||
    "Summary"
  );
}

function buildFilters(session) {
  const dimension = DIMENSIONS[session.dimension];
  if (!dimension || !session.value) {
    return {};
  }
  return {
    [dimension.filterKey]: session.value,
    ...(session.dimension === "agent" ? { agentField: "agentNames" } : {}),
  };
}

function formatSummary(title, summary) {
  return [
    title,
    `Total Leads: ${summary.totalLeads.toLocaleString("en-US")}`,
    `Total FTD: ${summary.totalFtd.toLocaleString("en-US")}`,
    `CR: ${formatPercent(summary.cr)}`,
    `CR Target: ${formatPercent(summary.crTarget)}`,
    `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
  ].join("\n");
}

function formatList(title, items) {
  if (!items.length) {
    return `${title}\nNo data found.`;
  }
  return [title, ...items.slice(0, 8).map((item, index) => `${index + 1}. ${item.label}: ${item.value}`)].join(
    "\n",
  );
}

export function formatMetricAnswer(metric, session, rows, tabConfig, now = new Date()) {
  const filters = buildFilters(session);
  const title = `${session.value || "CRM"} ${metricLabel(metric)}`;
  const summary = calculateSummary(rows, tabConfig, filters, now);

  if (metric === "summary") {
    return formatSummary(`${session.value || "CRM"} Summary`, summary);
  }

  if (metric === "totalLeads") {
    return `${title}\nTotal Leads: ${summary.totalLeads.toLocaleString("en-US")}`;
  }
  if (metric === "totalFtd") {
    return `${title}\nTotal FTD: ${summary.totalFtd.toLocaleString("en-US")}`;
  }
  if (metric === "cr") {
    return `${title}\nCR: ${formatPercent(summary.cr)}`;
  }
  if (metric === "crTargetReach") {
    return [
      title,
      `CR: ${formatPercent(summary.cr)}`,
      `CR Target: ${formatPercent(summary.crTarget)}`,
      `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
    ].join("\n");
  }
  if (metric === "lateFtd") {
    return `${title}\nLate FTD: ${summary.lateFtd.toLocaleString("en-US")}`;
  }
  if (metric === "statusDistribution") {
    return formatList("Status Distribution", statusDistribution(rows, tabConfig, filters, now));
  }
  if (metric === "topAgents" || metric === "topPerformers") {
    return formatList("Top Agents by FTD", topPerformers(rows, tabConfig, filters, "agentNames", "totalFtd", 8, now));
  }
  if (metric === "hourlyPerformance") {
    return formatList(
      "Hourly FTD Performance",
      hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now),
    );
  }

  return formatSummary(`${session.value || "CRM"} Summary`, summary);
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

  if (callbackData === "menu:main") {
    return startMenu(userId);
  }

  const [action, value] = String(callbackData || "").split(":");

  if (action === "dim") {
    const dimension = DIMENSIONS[value];
    if (!dimension) {
      return startMenu(userId);
    }
    const rows = await readRows("leads", { tabConfig });
    const values = uniqueValues(rows, tabConfig, dimension.fieldKey);
    setSession(userId, {
      dimension: value,
      options: values,
      value: null,
      step: "select_value",
    });

    return {
      text: values.length
        ? `Select ${dimension.label.toLowerCase()}:`
        : `No ${dimension.label.toLowerCase()} values found in the sheet.`,
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
      value: selectedValue,
      step: "select_metric",
    });

    return {
      text: `${dimensionLabel(session.dimension)}: ${selectedValue}\nSelect metric:`,
      replyMarkup: metricKeyboard(session.dimension),
    };
  }

  if (action === "metric") {
    const session = getSession(userId);
    const rows = await readRows("leads", { tabConfig });
    return {
      text: formatMetricAnswer(value, session, rows, tabConfig, options.now),
      replyMarkup: mainMenuKeyboard(),
    };
  }

  if (action === "quick") {
    const rows = await readRows("leads", { tabConfig });
    return {
      text: formatMetricAnswer(value, {}, rows, tabConfig, options.now),
      replyMarkup: mainMenuKeyboard(),
    };
  }

  return startMenu(userId);
}
