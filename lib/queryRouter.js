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
  "- How many FTD yesterday?",
  "- FTD this week in Turkey?",
  "- Germany total leads?",
  "- Uganda total FTD?",
  "- Ahmet total calls?",
  "- Ahmet FTD last 3 months?",
  "- Leader 1 leads last 4 months?",
  "- Istanbul desk yesterday leads?",
  "- May Turkey leads count?",
].join("\n");

export const HELLO_MESSAGE = [
  "Hello! Ask me CRM reporting questions in plain text.",
  "",
  "You can ask by date + scope:",
  "- yesterday FTD",
  "- this week FTD in Uganda",
  "- Ahmet last 3 months FTD",
  "- Leader 2 last 4 months leads",
  "- Istanbul desk total leads",
  "",
  "If scope is missing, I will ask follow-up.",
  "Reply with country / office(desk) / team leader / agent, or type `all` for total.",
].join("\n");

function normalize(text) {
  return String(text || "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function isPresentFilterValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return String(value).trim() !== "";
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function asIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function mondayStartUtc(date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(date.getTime() - offset * 24 * 60 * 60 * 1000);
}

function lastNMonthsRange(now, monthsCount) {
  const today = startOfUtcDay(now);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthsCount - 1), 1));
  return {
    type: "range",
    start: asIsoDate(start),
    end: asIsoDate(today),
  };
}

function mergeFilters(primary = {}, secondary = {}) {
  const merged = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if (isPresentFilterValue(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

export function isHelloCommand(text) {
  return /^\/?hello(?:@\w+)?(?:\s+.*)?$/i.test(String(text || "").trim());
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

export function extractDateFilter(text, now = new Date()) {
  const normalized = normalize(text);
  const today = startOfUtcDay(now);
  if (/\btoday\b/.test(normalized)) {
    return { type: "today" };
  }

  if (/\byesterday\b|(?:\bd[üu]n\b)/.test(normalized)) {
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return { type: "range", start: asIsoDate(yesterday), end: asIsoDate(yesterday) };
  }

  if (/\bthis\s+week\b|\bbu\s+hafta\b/.test(normalized)) {
    const start = mondayStartUtc(today);
    return { type: "range", start: asIsoDate(start), end: asIsoDate(today) };
  }

  if (/\blast\s+week\b|(?:\bge[cç]en\s+hafta\b)/.test(normalized)) {
    const thisWeekStart = mondayStartUtc(today);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastWeekEnd = new Date(thisWeekStart.getTime() - 24 * 60 * 60 * 1000);
    return { type: "range", start: asIsoDate(lastWeekStart), end: asIsoDate(lastWeekEnd) };
  }

  const lastMonthsMatch = normalized.match(/\b(?:last|son)\s*(3|4|three|four)\s*(?:months?|ay\w*)\b/);
  if (lastMonthsMatch) {
    const monthsCount = ["4", "four"].includes(lastMonthsMatch[1]) ? 4 : 3;
    return lastNMonthsRange(now, monthsCount);
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
  if (filters.date?.type === "range" && filters.date.start && filters.date.end) {
    if (filters.date.start === filters.date.end) {
      const date = new Date(`${filters.date.start}T00:00:00Z`);
      parts.push(
        Number.isNaN(date.getTime())
          ? filters.date.start
          : date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }),
      );
    } else {
      parts.push(`${filters.date.start} to ${filters.date.end}`);
    }
  }
  if (filters.country) {
    parts.push(filters.country);
  }
  if (filters.office) {
    parts.push(filters.office);
  }
  if (filters.teamLeader) {
    parts.push(filters.teamLeader);
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

  if (isHelloCommand(normalized)) {
    return { type: "hello" };
  }

  if (/^\/?start(?:@\w+)?(?:\s+.*)?$/i.test(normalized)) {
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

function hasScopeFilter(filters = {}) {
  return Boolean(filters.country || filters.office || filters.teamLeader || filters.agent);
}

export function shouldAskScopeFollowUp(parsed, filters = {}) {
  if (parsed?.type !== "metric") {
    return false;
  }
  if (!filters.date) {
    return false;
  }
  return !hasScopeFilter(filters);
}

export async function answerQueryDetailed(text, options = {}) {
  const now = options.now || new Date();
  const parsed = parseQuery(text, now);

  if (parsed.type === "start") {
    return { text: MAIN_MENU_TEXT, parsed, filters: {} };
  }

  if (parsed.type === "hello") {
    return { text: HELLO_MESSAGE, parsed, filters: {} };
  }

  if (parsed.type === "help" || parsed.type === "unknown") {
    return { text: HELP_MESSAGE, parsed, filters: {} };
  }

  const tabConfig = options.getTabConfig
    ? options.getTabConfig(parsed.tabKey)
    : getTabConfig(parsed.tabKey);
  const readRows = options.readRows || readSheetRows;
  const rows = await readRows(parsed.tabKey, { tabConfig });
  const filters = mergeFilters(
    mergeFilters(inferDynamicFilters(text, rows, tabConfig), parsed.filters || {}),
    options.scopeFilters || {},
  );
  const suffix = describeFilters(filters);

  if (parsed.type === "list") {
    if (parsed.list === "topAgents") {
      return {
        text: formatList(
          "Top Agents by FTD",
          topPerformers(rows, tabConfig, filters, "agentNames", "totalFtd", 8, now),
        ),
        parsed,
        filters,
      };
    }
    if (parsed.list === "ftdByHour") {
      return {
        text: formatList("FTD by Hour", hourlyDistribution(rows, tabConfig, filters, "created", "totalFtd", now)),
        parsed,
        filters,
      };
    }
    if (parsed.list === "campaignPerformance") {
      return {
        text: formatList(
          "Campaign Performance",
          topPerformers(rows, tabConfig, filters, "campaign", "totalFtd", 8, now),
        ),
        parsed,
        filters,
      };
    }
    if (parsed.list === "teamLeaderPerformance") {
      return {
        text: formatList(
          "Team Leader Performance",
          topPerformers(rows, tabConfig, filters, "teamLeader", "totalFtd", 8, now),
        ),
        parsed,
        filters,
      };
    }
    if (parsed.list === "statusDistribution") {
      return {
        text: formatList("Status Distribution", statusDistribution(rows, tabConfig, filters, now)),
        parsed,
        filters,
      };
    }
  }

  const summary = calculateSummary(rows, tabConfig, filters, now);

  if (parsed.metric.key === "totalLeads") {
    return { text: `${parsed.metric.label}${suffix}: ${summary.totalLeads.toLocaleString("en-US")}`, parsed, filters };
  }
  if (parsed.metric.key === "totalFtd") {
    return { text: `${parsed.metric.label}${suffix}: ${summary.totalFtd.toLocaleString("en-US")}`, parsed, filters };
  }
  if (parsed.metric.key === "cr") {
    return { text: `CR${suffix}: ${formatPercent(summary.cr)}`, parsed, filters };
  }
  if (parsed.metric.key === "crTargetReach") {
    return {
      text: [
        `CR Target Reach${suffix}`,
        `CR: ${formatPercent(summary.cr)}`,
        `CR Target: ${formatPercent(summary.crTarget)}`,
        `CR Target Reach: ${formatPercent(summary.crTargetReach)}`,
      ].join("\n"),
      parsed,
      filters,
    };
  }
  if (parsed.metric.key === "lateFtd") {
    return { text: `Late FTD${suffix}: ${summary.lateFtd.toLocaleString("en-US")}`, parsed, filters };
  }

  return { text: formatSummary(`CRM Summary${suffix}`, summary), parsed, filters };
}

export async function answerQuery(text, options = {}) {
  const result = await answerQueryDetailed(text, options);
  return result.text;
}
