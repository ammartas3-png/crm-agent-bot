import { getFieldName, getRowValue, normalizeText } from "./calculations.js";
import { normalizeAgentName } from "./targets.js";

function isSpreadsheetErrorValue(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("#n/a") ||
    normalized.startsWith("#value!") ||
    normalized.startsWith("#ref!") ||
    normalized.startsWith("#name?")
  );
}

export function agentNameFromFtdRow(row = {}, ftdTabConfig = {}) {
  const fields = ftdTabConfig?.fields || {};
  const candidates = [
    getRowValue(row, fields.agent || fields.agentNames),
    getRowValue(row, ftdTabConfig?.agentColumn),
    getRowValue(row, "AGENTS"),
    getRowValue(row, "Agents"),
    getRowValue(row, "Agent"),
    getRowValue(row, "AGENT NAMES"),
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text && !isSpreadsheetErrorValue(text)) {
      return text;
    }
  }
  return "";
}

export function buildKycFtdCountByAgent(ftdRows = [], ftdTabConfig = {}) {
  const counts = new Map();
  for (const row of ftdRows || []) {
    const normalized = normalizeAgentName(agentNameFromFtdRow(row, ftdTabConfig));
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

function agentMonthKeysFromLeadRows(rows = [], tabConfig = {}) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const seen = new Set();
  const keys = [];
  for (const row of rows || []) {
    const agent = normalizeAgentName(getRowValue(row, agentField));
    if (!agent) {
      continue;
    }
    const monthKey = String(row?.__sourceMonthKey || "").trim();
    const token = monthKey ? `${monthKey}::${agent}` : agent;
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keys.push({ agent, monthKey });
  }
  return keys;
}

export function kycFtdCountFromRows(rows = [], tabConfig = {}, infoContext = null) {
  if (!Array.isArray(rows) || !rows.length) {
    return 0;
  }
  const byMonthKey = infoContext?.kycFtdCountByAgentByMonthKey;
  if (byMonthKey instanceof Map && byMonthKey.size > 0) {
    let total = 0;
    for (const { agent, monthKey } of agentMonthKeysFromLeadRows(rows, tabConfig)) {
      if (!monthKey) {
        continue;
      }
      const monthMap = byMonthKey.get(monthKey);
      if (monthMap instanceof Map) {
        total += Number(monthMap.get(agent) || 0);
      }
    }
    if (total > 0) {
      return total;
    }
  }
  const singleMap = infoContext?.kycFtdCountByAgent;
  if (!(singleMap instanceof Map) || !singleMap.size) {
    return 0;
  }
  let total = 0;
  const seen = new Set();
  for (const { agent } of agentMonthKeysFromLeadRows(rows, tabConfig)) {
    if (seen.has(agent)) {
      continue;
    }
    seen.add(agent);
    total += Number(singleMap.get(agent) || 0);
  }
  return total;
}

export function attachKycFtdMapsToInfoContext(infoContext = {}, monthDataItems = []) {
  const byMonthKey = new Map();
  for (const item of monthDataItems || []) {
    const monthKey = String(item?.monthRecord?.key || "").trim();
    const agentMap = item?.kycFtdCountByAgent;
    if (monthKey && agentMap instanceof Map) {
      byMonthKey.set(monthKey, agentMap);
    }
  }
  if (byMonthKey.size) {
    infoContext.kycFtdCountByAgentByMonthKey = byMonthKey;
  }
  return infoContext;
}
