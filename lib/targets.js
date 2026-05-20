import { getFieldName, getRowValue, normalizeText } from "./calculations.js";

export function normalizeAgentName(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function parseTargetNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/#N\/A/gi, "")
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
  const workingStatusKey =
    keys.find((key) => {
      const normalizedKey = normalizeText(key);
      return normalizedKey.includes("working") || normalizedKey.includes("status");
    }) || keys[0];
  const agentKey =
    keys.find((key) => normalizeText(key).includes("agent") && !normalizeText(key).includes("target")) ||
    keys[2] ||
    keys[0];
  const targetKey = keys.find((key) => normalizeText(key).includes("target")) || keys[1];
  const officeKey = keys.find((key) => normalizeText(key).includes("office")) || keys[5];
  const teamLeaderKey =
    keys.find((key) => normalizeText(key).includes("team") && normalizeText(key).includes("leader")) || keys[6];
  return { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey };
}

export function buildInfoAgentsContext(infoAgentRows = []) {
  const targetsByAgent = new Map();
  const canonicalAgentByKey = new Map();
  const canonicalOfficeByKey = new Map();
  const canonicalTeamLeaderByKey = new Map();
  const officeAgents = new Map();
  const teamLeaderAgents = new Map();
  const teamLeadersByOffice = new Map();
  const workingAgents = [];

  function pushMapSet(map, key, value) {
    if (!key || !value) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key).add(value);
  }

  for (const row of infoAgentRows) {
    const { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey } = detectInfoAgentFields(row);
    const status = String(row?.[workingStatusKey] || "").trim();
    if (normalizeText(status) !== "working") {
      continue;
    }
    const agentName = String(row?.[agentKey] || "").trim();
    if (!agentName) {
      continue;
    }
    const office = String(row?.[officeKey] || "").trim();
    const teamLeader = String(row?.[teamLeaderKey] || "").trim();
    const normalizedAgent = normalizeAgentName(agentName);
    const normalizedOffice = normalizeText(office);
    const normalizedTeamLeader = normalizeText(teamLeader);
    const target = parseTargetNumber(row?.[targetKey]);

    workingAgents.push({
      agentName,
      normalizedAgent,
      office,
      normalizedOffice,
      teamLeader,
      normalizedTeamLeader,
      target,
    });
    canonicalAgentByKey.set(normalizedAgent, canonicalAgentByKey.get(normalizedAgent) || agentName);
    if (normalizedOffice) {
      canonicalOfficeByKey.set(
        normalizedOffice,
        canonicalOfficeByKey.get(normalizedOffice) || office,
      );
    }
    if (normalizedTeamLeader) {
      canonicalTeamLeaderByKey.set(
        normalizedTeamLeader,
        canonicalTeamLeaderByKey.get(normalizedTeamLeader) || teamLeader,
      );
    }
    targetsByAgent.set(normalizedAgent, target);
    pushMapSet(officeAgents, normalizedOffice, normalizedAgent);
    pushMapSet(teamLeaderAgents, normalizedTeamLeader, normalizedAgent);
    pushMapSet(teamLeadersByOffice, normalizedOffice, normalizedTeamLeader);
  }

  const offices = [...officeAgents.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const teamLeaders = [...teamLeaderAgents.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const agents = [...targetsByAgent.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));

  return {
    workingAgents,
    targetsByAgent,
    canonicalAgentByKey,
    canonicalOfficeByKey,
    canonicalTeamLeaderByKey,
    officeAgents,
    teamLeaderAgents,
    teamLeadersByOffice,
    offices,
    teamLeaders,
    agents,
  };
}

export function buildAgentTargetsMap(infoAgentRows = []) {
  return buildInfoAgentsContext(infoAgentRows).targetsByAgent;
}

export function infoAgentsLabelsForGroup(infoContext, groupField, filters = {}) {
  if (!infoContext) {
    return [];
  }
  if (groupField === "office") {
    return infoContext.offices
      .map((item) => infoContext.canonicalOfficeByKey.get(item) || item)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (groupField === "teamLeader") {
    const office = normalizeText(filters.office);
    if (office && infoContext.teamLeadersByOffice.has(office)) {
      return [...infoContext.teamLeadersByOffice.get(office)]
        .map((item) => infoContext.canonicalTeamLeaderByKey.get(item) || item)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    return infoContext.teamLeaders
      .map((item) => infoContext.canonicalTeamLeaderByKey.get(item) || item)
      .filter(Boolean);
  }
  if (groupField === "agentNames") {
    const teamLeader = normalizeText(filters.teamLeader);
    if (teamLeader && infoContext.teamLeaderAgents.has(teamLeader)) {
      return [...infoContext.teamLeaderAgents.get(teamLeader)]
        .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    const office = normalizeText(filters.office);
    if (office && infoContext.officeAgents.has(office)) {
      return [...infoContext.officeAgents.get(office)]
        .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    return infoContext.agents
      .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
      .filter(Boolean);
  }
  return [];
}

export function targetForOffice(infoContext, officeLabel) {
  if (!infoContext) {
    return 0;
  }
  const office = normalizeText(officeLabel);
  const agents = infoContext.officeAgents.get(office);
  if (!agents) {
    return 0;
  }
  return [...agents].reduce((sum, agent) => sum + (infoContext.targetsByAgent.get(agent) || 0), 0);
}

export function targetForTeamLeader(infoContext, teamLeaderLabel) {
  if (!infoContext) {
    return 0;
  }
  const teamLeader = normalizeText(teamLeaderLabel);
  const agents = infoContext.teamLeaderAgents.get(teamLeader);
  if (!agents) {
    return 0;
  }
  return [...agents].reduce((sum, agent) => sum + (infoContext.targetsByAgent.get(agent) || 0), 0);
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
