import { getTabConfig } from "../config/sheetsConfig.js";
import {
  calculateSummary,
  formatPercent,
  hourlyDistribution,
  parseMonth,
  statusDistribution,
  topPerformers,
  uniqueValues,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { MAIN_MENU_TEXT } from "./menu.js";

const COUNTRY_ALIASES = new Map([
  ["germany", "Germany"],
  ["deutschland", "Germany"],
  ["de", "Germany"],
  ["turkey", "Turkey"],
  ["turkiye", "Turkey"],
  ["türkiye", "Turkey"],
  ["tr", "Turkey"],
  ["uk", "United Kingdom"],
  ["united kingdom", "United Kingdom"],
  ["england", "United Kingdom"],
  ["spain", "Spain"],
  ["es", "Spain"],
  ["italy", "Italy"],
  ["it", "Italy"],
  ["france", "France"],
  ["fr", "France"],
]);

const HELP_MESSAGE = [
  "I can answer simple CRM reporting questions.",
  "",
  "Examples:",
  "- How many FTD today?",
  "- Germany total leads?",
  "- Ahmet total calls?",
  "- May Turkey leads count?",
].join("\n");

function normalize(text) {
  return String(text || "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function titleCase(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractCountry(text) {
  const normalized = normalize(text);
  const aliases = [...COUNTRY_ALIASES.keys()].sort((a, b) => b.length - a.length);
  const match = aliases.find((alias) =>
    new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
      normalized,
    ),
  );
  return match ? COUNTRY_ALIASES.get(match) : null;
}

function extractDateFilter(text, now = new Date()) {
  const normalized = normalize(text);
  if (/\btoday\b/.test(normalized)) {
    return { type: "today" };
  }

  if (/\bthis\s+month\b|\bcurrent\s+month\b/.test(normalized)) {
    return { type: "month", month: now.getUTCMonth(), year: now.getUTCFullYear() };
  }

  const month = parseMonth(normalized);
  if (month !== null) {
    return { type: "month", month, year: now.getUTCFullYear() };
  }

  return null;
}

function extractAgent(text) {
  const trimmed = String(text || "").trim();
  const totalCallsMatch = trimmed.match(/^(.+?)\s+total\s+calls?\b/i);
  if (totalCallsMatch) {
    return titleCase(totalCallsMatch[1]);
  }

  const agentMatch = trimmed.match(/\bagent\s+([a-zğüşöçıİĞÜŞÖÇ]+(?:\s+[a-zğüşöçıİĞÜŞÖÇ]+)*)/i);
  if (agentMatch) {
    return titleCase(agentMatch[1]);
  }

  return null;
}

function describeFilters(filters = {}) {
  const parts = [];
  if (filters.date?.type === "today") {
    parts.push("today");
  }
  if (filters.date?.type === "month") {
    const monthName = new Date(Date.UTC(filters.date.year, filters.date.month, 1)).toLocaleString(
      "en-US",
      { month: "long" },
    );
    parts.push(monthName);
  }
  if (filters.country) {
    parts.push(filters.country);
  }
  if (filters.agent) {
    parts.push(filters.agent);
  }
  if (filters.status) {
    parts.push(filters.status);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
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

function inferDynamicFilters(text, rows, tabConfig) {
  const normalized = normalize(text);
  const filters = {
    country: extractCountry(text),
    date: extractDateFilter(text),
  };

  const filterFields = [
    ["country", "country"],
    ["office", "office"],
    ["teamLeader", "teamLeader"],
    ["agent", "agentNames"],
    ["brand", "brand"],
    ["campaign", "campaign"],
  ];

  for (const [filterKey, fieldKey] of filterFields) {
    if (filters[filterKey]) {
      continue;
    }
    const match = uniqueValues(rows, tabConfig, fieldKey, 500).find((value) =>
      normalized.includes(normalize(value)),
    );
    if (match) {
      filters[filterKey] = match;
    }
  }

  if (filters.agent) {
    filters.agentField = "agentNames";
  }

  return filters;
}

export function parseQuery(text, now = new Date()) {
  const normalized = normalize(text);
  const filters = {
    country: extractCountry(text),
    date: extractDateFilter(text, now),
  };

  if (!normalized || normalized === "/help") {
    return { type: "help" };
  }

  if (normalized === "/start") {
    return { type: "start" };
  }

  if (/\btop\s+agents?\b|\btop\s+performers?\b/.test(normalized)) {
    return {
      type: "list",
      list: "topAgents",
      tabKey: "leads",
    };
  }

  if (/\bftd\b.*\bhour\b|\bhour\b.*\bftd\b/.test(normalized)) {
    return {
      type: "list",
      list: "ftdByHour",
      tabKey: "leads",
    };
  }

  if (/\bcampaign\b.*\bperformance\b|\bperformance\b.*\bcampaign\b/.test(normalized)) {
    return {
      type: "list",
      list: "campaignPerformance",
      tabKey: "leads",
    };
  }

  if (/\bteam\s+leader\b.*\bperformance\b|\bperformance\b.*\bteam\s+leader\b/.test(normalized)) {
    return {
      type: "list",
      list: "teamLeaderPerformance",
      tabKey: "leads",
    };
  }

  if (/\bstatus\b.*\bdistribution\b/.test(normalized)) {
    return {
      type: "list",
      list: "statusDistribution",
      tabKey: "leads",
    };
  }

  if (/\btarget\s+reach\b/.test(normalized)) {
    return {
      type: "metric",
      metric: { key: "crTargetReach", label: "CR Target Reach" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\blate\s+ftd\b/.test(normalized)) {
    return {
      type: "metric",
      metric: { key: "lateFtd", label: "Late FTD" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\bftd\b/.test(normalized)) {
    return {
      type: "metric",
      metric: { key: "totalFtd", label: "Total FTD" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\bcr\b|\bconversion\b/.test(normalized)) {
    return {
      type: "metric",
      metric: { key: "cr", label: "CR" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\btotal\s+calls?\b/.test(normalized) || /\bcalls?\b/.test(normalized)) {
    filters.agent = extractAgent(text);
    filters.agentField = "firstCallAgent";
    return {
      type: "metric",
      metric: { key: "totalLeads", label: "total calls" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\bleads?\b/.test(normalized)) {
    return {
      type: "metric",
      metric: { key: "totalLeads", label: "leads" },
      tabKey: "leads",
      filters,
    };
  }

  if (/\btransactions?\b|\bdeposit\b|\bwithdrawal\b/.test(normalized)) {
    if (/\bdeposit\b/.test(normalized)) {
      filters.status = "Deposit";
    }
    if (/\bwithdrawal\b/.test(normalized)) {
      filters.status = "Withdrawal";
    }
    return {
      type: "metric",
      metric: { key: "transactionAmount", label: "transaction amount", operation: "sum" },
      tabKey: "transactions",
      filters,
    };
  }

  return { type: "unknown" };
}

export async function answerQuery(text, options = {}) {
  const now = options.now || new Date();
  const parsed = parseQuery(text, now);

  if (parsed.type === "start") {
    return MAIN_MENU_TEXT;
  }

  if (parsed.type === "help" || parsed.type === "unknown") {
    return HELP_MESSAGE;
  }

  const tabConfig = options.getTabConfig
    ? options.getTabConfig(parsed.tabKey)
    : getTabConfig(parsed.tabKey);
  const readRows = options.readRows || readSheetRows;
  const rows = await readRows(parsed.tabKey, { tabConfig });
  const filters = {
    ...inferDynamicFilters(text, rows, tabConfig),
    ...(parsed.filters || {}),
  };
  const suffix = describeFilters(filters);

  if (parsed.type === "list") {
    if (parsed.list === "topAgents") {
      return formatList("Top Agents by FTD", topPerformers(rows, tabConfig, filters, "agentNames", "totalFtd", 8, now));
    }
    if (parsed.list === "ftdByHour") {
      return formatList("FTD by Hour", hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now));
    }
    if (parsed.list === "campaignPerformance") {
      return formatList(
        "Campaign Performance",
        topPerformers(rows, tabConfig, filters, "campaign", "totalFtd", 8, now),
      );
    }
    if (parsed.list === "teamLeaderPerformance") {
      return formatList(
        "Team Leader Performance",
        topPerformers(rows, tabConfig, filters, "teamLeader", "totalFtd", 8, now),
      );
    }
    if (parsed.list === "statusDistribution") {
      return formatList("Status Distribution", statusDistribution(rows, tabConfig, filters, now));
    }
  }

  const summary = calculateSummary(rows, tabConfig, filters, now);

  if (parsed.metric.key === "totalLeads") {
    return `${parsed.metric.label}${suffix}: ${summary.totalLeads.toLocaleString("en-US")}`;
  }
  if (parsed.metric.key === "totalFtd") {
    return `${parsed.metric.label}${suffix}: ${summary.totalFtd.toLocaleString("en-US")}`;
  }
  if (parsed.metric.key === "cr") {
    return `CR${suffix}: ${formatPercent(summary.cr)}`;
  }
  if (parsed.metric.key === "crTargetReach") {
    return [
      `CR Target Reach${suffix}`,
      `CR: ${formatPercent(summary.cr)}`,
      `CR Target: ${formatPercent(summary.crTarget)}`,
      `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
    ].join("\n");
  }
  if (parsed.metric.key === "lateFtd") {
    return `Late FTD${suffix}: ${summary.lateFtd.toLocaleString("en-US")}`;
  }

  return formatSummary(`CRM Summary${suffix}`, summary);
}
