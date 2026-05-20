import { getFieldName, getRowValue, normalizeText } from "./calculations.js";

export function normalizeAgentName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function parseTargetNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/[,%]/g, "")
    .replace(",", ".")
    .trim();
  if (!cleaned) {
    return 0;
  }
  const target = Number(cleaned);
  return Number.isFinite(target) ? target : 0;
}

function detectInfoAgentFields(row = {}) {
  const keys = Object.keys(row);
  const agentKey =
    keys.find((key) => normalizeText(key).includes("agent") && !normalizeText(key).includes("target")) || keys[0];
  const targetKey = keys.find((key) => normalizeText(key).includes("target")) || keys[1];
  return { agentKey, targetKey };
}

export function buildAgentTargetsMap(infoAgentRows = []) {
  const targets = new Map();
  for (const row of infoAgentRows) {
    const { agentKey, targetKey } = detectInfoAgentFields(row);
    const agentName = String(row?.[agentKey] || "").trim();
    if (!agentName) {
      continue;
    }
    targets.set(normalizeAgentName(agentName), parseTargetNumber(row?.[targetKey]));
  }
  return targets;
}

export function agentTarget(targetsMap, agentName) {
  const key = normalizeAgentName(agentName);
  return targetsMap.get(key) || 0;
}

export function summarizeTarget(agentNames = [], targetsMap = new Map()) {
  const uniqueNames = new Set(agentNames.map(normalizeAgentName).filter(Boolean));
  let totalTarget = 0;
  for (const name of uniqueNames) {
    totalTarget += targetsMap.get(name) || 0;
  }
  return totalTarget;
}

export function targetReachPercent(totalFtd, totalTarget) {
  if (!Number.isFinite(totalTarget) || totalTarget <= 0) {
    return null;
  }
  return (Number(totalFtd || 0) / totalTarget) * 100;
}

export function formatTarget(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return value.toLocaleString("en-US");
}

export function formatOptionalPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}

export function collectAgentNames(rows = [], tabConfig) {
  const fieldName = getFieldName(tabConfig, "agentNames");
  return rows
    .map((row) => String(getRowValue(row, fieldName) || "").trim())
    .filter(Boolean);
}
