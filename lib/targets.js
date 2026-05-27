import {
  getFieldName,
  getFtdRowsByDateRange,
  getRowValue,
  normalizeText,
  withoutDateFilters,
} from "./calculations.js";

const AGENT_ALIAS_BY_NORMALIZED = new Map([
  ["asli gu", "annalena gu"],
]);

const CANONICAL_AGENT_DISPLAY_BY_NORMALIZED = new Map([
  ["annalena gu", "Annalena Gu"],
]);

function cleanAgentName(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeAgentName(value) {
  const normalized = cleanAgentName(value).toLocaleLowerCase("en-US");
  return AGENT_ALIAS_BY_NORMALIZED.get(normalized) || normalized;
}

export function canonicalAgentName(value) {
  const normalized = normalizeAgentName(value);
  if (!normalized) {
    return "";
  }
  return CANONICAL_AGENT_DISPLAY_BY_NORMALIZED.get(normalized) || cleanAgentName(value);
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

function parseWorkingStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === "working") {
    return "working";
  }
  if (normalized === "not working") {
    return "not_working";
  }
  return normalized;
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
  const targetKey = keys.find((key) => normalizeText(key).includes("target")) || keys[3] || keys[1];
  const officeKey = keys.find((key) => normalizeText(key).includes("office")) || keys[5];
  const teamLeaderKey =
    keys.find((key) => normalizeText(key).includes("team") && normalizeText(key).includes("leader")) || keys[6];
  return { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey };
}

function pushMapSet(map, key, value) {
  if (!key || !value) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(value);
}

function humanizeKey(normalizedKey) {
  return String(normalizedKey || "")
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ")
    .trim();
}

export function buildInfoAgentsContext(infoAgentRows = []) {
  const latestByAgent = new Map();
  const seenRowsByAgent = new Map();
  const officesByAgent = new Map();
  const canonicalAgentByKey = new Map();
  const duplicateNormalizedAgents = new Set();
  const multiOfficeAgents = new Set();
  let rowIndex = 0;

  for (const row of infoAgentRows) {
    rowIndex += 1;
    const { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey } = detectInfoAgentFields(row);
    const rawAgentName = String(row?.[agentKey] || "").trim();
    if (!rawAgentName) {
      continue;
    }
    const normalizedAgent = normalizeAgentName(rawAgentName);
    if (!normalizedAgent) {
      continue;
    }
    const agentName = canonicalAgentName(rawAgentName);

    const office = String(row?.[officeKey] || "").trim();
    const teamLeader = String(row?.[teamLeaderKey] || "").trim();
    const normalizedOffice = normalizeText(office);
    const normalizedTeamLeader = normalizeText(teamLeader);
    const workingStatus = parseWorkingStatus(row?.[workingStatusKey]);
    if (workingStatus !== "working" && workingStatus !== "not_working") {
      continue;
    }
    const target = parseTargetNumber(row?.[targetKey]);

    if (!seenRowsByAgent.has(normalizedAgent)) {
      seenRowsByAgent.set(normalizedAgent, []);
    }
    seenRowsByAgent.get(normalizedAgent).push({
      rowIndex,
      office: normalizedOffice,
      teamLeader: normalizedTeamLeader,
    });
    if (seenRowsByAgent.get(normalizedAgent).length > 1) {
      duplicateNormalizedAgents.add(normalizedAgent);
    }

    if (!officesByAgent.has(normalizedAgent)) {
      officesByAgent.set(normalizedAgent, new Set());
    }
    if (normalizedOffice) {
      officesByAgent.get(normalizedAgent).add(normalizedOffice);
      if (officesByAgent.get(normalizedAgent).size > 1) {
        multiOfficeAgents.add(normalizedAgent);
      }
    }

    canonicalAgentByKey.set(normalizedAgent, canonicalAgentByKey.get(normalizedAgent) || agentName);
    // Latest valid row wins for final membership/assignment.
    latestByAgent.set(normalizedAgent, {
      agent_name: agentName,
      normalized_name: normalizedAgent,
      office,
      normalized_office: normalizedOffice,
      team_leader: teamLeader,
      normalized_team_leader: normalizedTeamLeader,
      working_status: workingStatus,
      target,
      row_index: rowIndex,
    });
  }

  const records = [...latestByAgent.values()];
  const byAgent = new Map(records.map((record) => [record.normalized_name, record]));
  const targetsByAgent = new Map(records.map((record) => [record.normalized_name, record.target]));
  const workingAgents = records.filter((record) => record.working_status === "working");

  const officeAgentsAll = new Map();
  const teamLeaderAgentsAll = new Map();
  const teamLeadersByOfficeAll = new Map();
  const officeAgentsWorking = new Map();
  const teamLeaderAgentsWorking = new Map();
  const teamLeadersByOfficeWorking = new Map();
  const canonicalOfficeByKey = new Map();
  const canonicalTeamLeaderByKey = new Map();

  for (const record of records) {
    if (record.normalized_office) {
      canonicalOfficeByKey.set(
        record.normalized_office,
        canonicalOfficeByKey.get(record.normalized_office) || record.office,
      );
    }
    if (record.normalized_team_leader) {
      canonicalTeamLeaderByKey.set(
        record.normalized_team_leader,
        canonicalTeamLeaderByKey.get(record.normalized_team_leader) || record.team_leader,
      );
    }

    pushMapSet(officeAgentsAll, record.normalized_office, record.normalized_name);
    pushMapSet(teamLeaderAgentsAll, record.normalized_team_leader, record.normalized_name);
    pushMapSet(teamLeadersByOfficeAll, record.normalized_office, record.normalized_team_leader);

    if (record.working_status === "working") {
      pushMapSet(officeAgentsWorking, record.normalized_office, record.normalized_name);
      pushMapSet(teamLeaderAgentsWorking, record.normalized_team_leader, record.normalized_name);
      pushMapSet(teamLeadersByOfficeWorking, record.normalized_office, record.normalized_team_leader);
    }
  }

  const offices = [...officeAgentsWorking.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const teamLeaders = [...teamLeaderAgentsWorking.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const agents = [...workingAgents.map((record) => record.normalized_name)].sort((a, b) => a.localeCompare(b));
  const allAgents = [...byAgent.keys()].sort((a, b) => a.localeCompare(b));

  return {
    records,
    byAgent,
    targetsByAgent,
    canonicalAgentByKey,
    canonicalOfficeByKey,
    canonicalTeamLeaderByKey,
    offices,
    teamLeaders,
    agents,
    allAgents,
    workingAgents,
    officeAgents: officeAgentsWorking,
    teamLeaderAgents: teamLeaderAgentsWorking,
    teamLeadersByOffice: teamLeadersByOfficeWorking,
    officeAgentsAll,
    teamLeaderAgentsAll,
    teamLeadersByOfficeAll,
    duplicateNormalizedAgents: [...duplicateNormalizedAgents].sort((a, b) => a.localeCompare(b)),
    multiOfficeAgents: [...multiOfficeAgents].sort((a, b) => a.localeCompare(b)),
    missingOfficeOrTeamLeaderAgents: records
      .filter((record) => !record.normalized_office || !record.normalized_team_leader)
      .map((record) => record.normalized_name)
      .sort((a, b) => a.localeCompare(b)),
    humanizeKey,
  };
}

export function buildAgentTargetsMap(infoAgentRows = []) {
  return buildInfoAgentsContext(infoAgentRows).targetsByAgent;
}

export function infoAgentsLabelsForGroup(infoContext, groupField, filters = {}) {
  if (!infoContext) {
    return [];
  }

  const asCanonicalAgents = (items) =>
    items
      .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  const asCanonicalOffices = (items) =>
    items
      .map((item) => infoContext.canonicalOfficeByKey.get(item) || infoContext.humanizeKey(item))
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  const asCanonicalTeamLeaders = (items) =>
    items
      .map(
        (item) =>
          infoContext.canonicalTeamLeaderByKey.get(item) || infoContext.humanizeKey(item),
      )
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

  if (groupField === "office") {
    return asCanonicalOffices(infoContext.offices);
  }
  if (groupField === "teamLeader") {
    const office = normalizeText(filters.office);
    if (office && infoContext.teamLeadersByOffice.has(office)) {
      return asCanonicalTeamLeaders([...infoContext.teamLeadersByOffice.get(office)]);
    }
    return asCanonicalTeamLeaders(infoContext.teamLeaders);
  }
  if (groupField === "agentNames") {
    const teamLeader = normalizeText(filters.teamLeader);
    if (teamLeader && infoContext.teamLeaderAgents.has(teamLeader)) {
      return asCanonicalAgents([...infoContext.teamLeaderAgents.get(teamLeader)]);
    }
    const office = normalizeText(filters.office);
    if (office && infoContext.officeAgents.has(office)) {
      return asCanonicalAgents([...infoContext.officeAgents.get(office)]);
    }
    return asCanonicalAgents(infoContext.agents);
  }
  return [];
}

export function targetForOffice(infoContext, officeLabel) {
  if (!infoContext) {
    return 0;
  }
  const office = normalizeText(officeLabel);
  const agents = infoContext.officeAgentsAll.get(office);
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
  const agents = infoContext.teamLeaderAgentsAll.get(teamLeader);
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

export function includedTargetForStatus({ working_status, target, ftd }) {
  const safeTarget = Number.isFinite(target) ? target : 0;
  if (safeTarget <= 0) {
    return 0;
  }
  if (working_status === "not_working") {
    return Number(ftd || 0) >= safeTarget ? safeTarget : 0;
  }
  return safeTarget;
}

function buildFtdByAgent(rows, tabConfig, filters = {}, now = new Date()) {
  const ftdRows = getFtdRowsByDateRange(rows, tabConfig, filters, now);
  const ftdMakerField = getFieldName(tabConfig, "ftdMaker");
  const agentField = getFieldName(tabConfig, "agentNames");
  const ftdByAgent = new Map();
  for (const row of ftdRows) {
    if (!String(getRowValue(row, ftdMakerField) || "").trim()) {
      continue;
    }
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (!normalizedAgent) {
      continue;
    }
    ftdByAgent.set(normalizedAgent, (ftdByAgent.get(normalizedAgent) || 0) + 1);
  }
  return ftdByAgent;
}

function agentsFromRows(rows, tabConfig) {
  const fieldName = getFieldName(tabConfig, "agentNames");
  const agents = new Set();
  for (const row of rows) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, fieldName));
    if (normalizedAgent) {
      agents.add(normalizedAgent);
    }
  }
  return agents;
}

function candidateAgentsByScope(infoContext, rows, tabConfig, filters = {}, scope = {}) {
  const candidates = new Set();
  const normalizedOffice = normalizeText(scope.office || filters.office);
  const normalizedTeamLeader = normalizeText(scope.teamLeader || filters.teamLeader);
  const normalizedAgent = normalizeAgentName(scope.agent || filters.agent);

  if (normalizedAgent) {
    candidates.add(normalizedAgent);
  } else if (normalizedTeamLeader) {
    const mapped = infoContext?.teamLeaderAgentsAll?.get(normalizedTeamLeader);
    if (mapped) {
      for (const agent of mapped) {
        candidates.add(agent);
      }
    }
  } else if (normalizedOffice) {
    const mapped = infoContext?.officeAgentsAll?.get(normalizedOffice);
    if (mapped) {
      for (const agent of mapped) {
        candidates.add(agent);
      }
    }
  } else if (scope.groupField === "office") {
    for (const agent of infoContext?.allAgents || []) {
      candidates.add(agent);
    }
  } else if (scope.groupField === "teamLeader") {
    for (const agent of infoContext?.allAgents || []) {
      candidates.add(agent);
    }
  } else if (scope.groupField === "agentNames") {
    for (const agent of infoContext?.allAgents || []) {
      candidates.add(agent);
    }
  } else {
    for (const agent of infoContext?.allAgents || []) {
      candidates.add(agent);
    }
  }

  // Always add agents present in filtered rows so unmapped agents are still visible in validation.
  for (const agent of agentsFromRows(rows, tabConfig)) {
    candidates.add(agent);
  }
  return candidates;
}

export function targetAggregationForScope({
  rows = [],
  tabConfig,
  infoContext,
  filters = {},
  scope = {},
  now = new Date(),
}) {
  const ftdByAgent = buildFtdByAgent(rows, tabConfig, filters, now);
  const candidateAgents = candidateAgentsByScope(infoContext, rows, tabConfig, filters, scope);
  const details = [];
  let includedTarget = 0;
  let totalFtd = 0;

  for (const normalizedName of candidateAgents) {
    const record = infoContext?.byAgent?.get(normalizedName) || null;
    const target = record?.target || 0;
    const ftd = ftdByAgent.get(normalizedName) || 0;
    const included = includedTargetForStatus({
      working_status: record?.working_status || "",
      target,
      ftd,
    });
    includedTarget += included;
    totalFtd += ftd;

    details.push({
      agent_name: record?.agent_name || infoContext?.canonicalAgentByKey?.get(normalizedName) || normalizedName,
      normalized_name: normalizedName,
      office: record?.office || "",
      team_leader: record?.team_leader || "",
      working_status: record?.working_status || "",
      target,
      ftd,
      included_target: included,
    });
  }

  return {
    includedTarget,
    totalFtd,
    details,
  };
}
