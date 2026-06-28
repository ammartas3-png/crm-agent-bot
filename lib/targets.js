import {
  getFieldName,
  getFtdRowsByDateRange,
  parseDateValue,
  getRowValue,
  normalizeText,
  withoutDateFilters,
} from "./calculations.js";

const AGENT_ALIAS_BY_NORMALIZED = new Map();

const CANONICAL_AGENT_DISPLAY_BY_NORMALIZED = new Map();

function normalizedFilterValues(value, normalizer = normalizeText) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizer(item)).filter(Boolean);
  }
  const normalized = normalizer(value);
  return normalized ? [normalized] : [];
}

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

function isLikelyAgentTargetKey(key = "") {
  const normalizedKey = normalizeText(key).replace(/[’'`]/g, "");
  if (!normalizedKey || !normalizedKey.includes("target")) {
    return false;
  }
  if (normalizedKey.includes("cr target")) {
    return false;
  }
  if (normalizedKey.includes("reach")) {
    return false;
  }
  if (normalizedKey.includes("ftd target by cr")) {
    return false;
  }
  if (normalizedKey.includes("missing ftd")) {
    return false;
  }
  return true;
}

function parseWorkingStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === "working" || normalized === "active") {
    return "working";
  }
  if (
    normalized === "not working" ||
    normalized === "not_working" ||
    normalized === "not active" ||
    normalized === "inactive" ||
    normalized === "left"
  ) {
    return "not_working";
  }
  return normalized;
}

function parseStartDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Guard against small numeric targets being treated as dates.
    if (value < 20000 || value > 90000) {
      return null;
    }
    const parsedNumberDate = parseDateValue(value);
    if (!parsedNumberDate) {
      return null;
    }
    const year = parsedNumberDate.getUTCFullYear();
    return year >= 1990 && year <= 2100 ? parsedNumberDate : null;
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const normalized = normalizeText(raw);
  if (
    normalized === "starting date" ||
    normalized === "start date" ||
    normalized === "job entry" ||
    normalized === "ise giris"
  ) {
    return null;
  }
  const looksLikeDate =
    /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(raw) ||
    /^\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(raw);
  if (!looksLikeDate) {
    return null;
  }
  const parsed = parseDateValue(value);
  if (!parsed) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > 2100) {
    return null;
  }
  return parsed;
}

function sanitizeStartDate(value) {
  const parsed = parseStartDate(value);
  if (!parsed) {
    return "";
  }
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = String(parsed.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

function preferredStartDate(previousValue = "", nextValue = "") {
  const previous = sanitizeStartDate(previousValue);
  const next = sanitizeStartDate(nextValue);
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  const previousDate = parseDateValue(previous);
  const nextDate = parseDateValue(next);
  if (!previousDate || !nextDate) {
    return previous || next;
  }
  return nextDate.getTime() < previousDate.getTime() ? next : previous;
}

function detectInfoAgentFields(row = {}) {
  const keys = Object.keys(row);
  const workingStatusKey =
    keys.find((key) => {
      const normalizedKey = normalizeText(key);
      return normalizedKey.includes("working") || normalizedKey.includes("status");
    }) || keys[0];
  const agentKey =
    keys.find((key) => {
      const normalizedKey = normalizeText(key);
      return (
        normalizedKey.includes("agent") &&
        !normalizedKey.includes("target") &&
        !normalizedKey.includes("id")
      );
    }) ||
    keys[2] ||
    keys[0];
  const targetKey = keys.find((key) => normalizeText(key).includes("target")) || keys[3] || keys[1];
  const officeKey =
    keys.find((key) => {
      const normalizedKey = normalizeText(key);
      return normalizedKey.includes("office") || normalizedKey.includes("desk");
    }) || keys[5];
  const teamLeaderKey =
    keys.find((key) => normalizeText(key).includes("team") && normalizeText(key).includes("leader")) || keys[6];
  const startDateKeyCandidates = keys.filter((key) => {
    const normalizedKey = normalizeText(key);
    return (
      normalizedKey.includes("starting") ||
      (normalizedKey.includes("start") && normalizedKey.includes("date")) ||
      normalizedKey.includes("job entry") ||
      normalizedKey.includes("ise giris")
    );
  });
  const dateValueCandidates = keys.filter((key) => sanitizeStartDate(row?.[key]));
  const startDateKey =
    startDateKeyCandidates.find((key) => sanitizeStartDate(row?.[key])) ||
    startDateKeyCandidates[0] ||
    dateValueCandidates[dateValueCandidates.length - 1] ||
    "";
  return { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey, startDateKey };
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
  const startDateByAgent = new Map();
  const seenRowsByAgent = new Map();
  const officesByAgent = new Map();
  const canonicalAgentByKey = new Map();
  const duplicateNormalizedAgents = new Set();
  const multiOfficeAgents = new Set();
  let rowIndex = 0;

  for (const row of infoAgentRows) {
    rowIndex += 1;
    const { workingStatusKey, agentKey, targetKey, officeKey, teamLeaderKey, startDateKey } = detectInfoAgentFields(row);
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
    const startDate = startDateKey ? sanitizeStartDate(row?.[startDateKey]) : "";
    if (startDate) {
      startDateByAgent.set(normalizedAgent, preferredStartDate(startDateByAgent.get(normalizedAgent) || "", startDate));
    }
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
    const previous = latestByAgent.get(normalizedAgent);
    latestByAgent.set(normalizedAgent, {
      agent_name: agentName,
      normalized_name: normalizedAgent,
      office,
      normalized_office: normalizedOffice,
      team_leader: teamLeader,
      normalized_team_leader: normalizedTeamLeader,
      start_date: preferredStartDate(previous?.start_date || "", startDate),
      working_status: workingStatus,
      target,
      row_index: rowIndex,
    });
  }

  const records = [...latestByAgent.values()];
  for (const record of records) {
    const fallbackStartDate = startDateByAgent.get(record.normalized_name) || "";
    if (fallbackStartDate) {
      record.start_date = preferredStartDate(record.start_date || "", fallbackStartDate);
      startDateByAgent.set(record.normalized_name, preferredStartDate(fallbackStartDate, record.start_date || ""));
    }
  }
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
    startDateByAgent,
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
    const selectedOffices = normalizedFilterValues(filters.office);
    if (selectedOffices.length) {
      return asCanonicalOffices(selectedOffices);
    }
    return asCanonicalOffices(infoContext.offices);
  }
  if (groupField === "teamLeader") {
    const selectedTeamLeaders = normalizedFilterValues(filters.teamLeader);
    if (selectedTeamLeaders.length) {
      return asCanonicalTeamLeaders(selectedTeamLeaders);
    }
    const offices = normalizedFilterValues(filters.office);
    if (offices.length) {
      const leaders = new Set();
      for (const office of offices) {
        const officeLeaders = infoContext.teamLeadersByOffice.get(office);
        if (!officeLeaders) {
          continue;
        }
        for (const leader of officeLeaders) {
          leaders.add(leader);
        }
      }
      if (leaders.size) {
        return asCanonicalTeamLeaders([...leaders]);
      }
      return [];
    }
    return asCanonicalTeamLeaders(infoContext.teamLeaders);
  }
  if (groupField === "agentNames") {
    const selectedAgents = normalizedFilterValues(filters.agent, normalizeAgentName);
    if (selectedAgents.length) {
      return asCanonicalAgents(selectedAgents);
    }
    const teamLeaders = normalizedFilterValues(filters.teamLeader);
    if (teamLeaders.length) {
      const agents = new Set();
      for (const teamLeader of teamLeaders) {
        const mappedAgents = infoContext.teamLeaderAgents.get(teamLeader);
        if (!mappedAgents) {
          continue;
        }
        for (const agent of mappedAgents) {
          agents.add(agent);
        }
      }
      if (agents.size) {
        return asCanonicalAgents([...agents]);
      }
    }
    const offices = normalizedFilterValues(filters.office);
    if (offices.length) {
      const agents = new Set();
      for (const office of offices) {
        const mappedAgents = infoContext.officeAgents.get(office);
        if (!mappedAgents) {
          continue;
        }
        for (const agent of mappedAgents) {
          agents.add(agent);
        }
      }
      if (agents.size) {
        return asCanonicalAgents([...agents]);
      }
      return [];
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

function buildRowTargetByAgent(rows, tabConfig) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const leadDateField = getFieldName(tabConfig, "leadDate");
  const createdField = getFieldName(tabConfig, "created");
  const firstRowKeys = Object.keys(rows?.[0] || {});
  const dynamicTargetKeys = firstRowKeys.filter((key) => isLikelyAgentTargetKey(key));
  const targetByAgentByMonth = new Map();
  const targetByAgent = new Map();
  for (const row of rows || []) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (!normalizedAgent) {
      continue;
    }
    const rawTargetCandidates = [
      getRowValue(row, "TARGET'S"),
      getRowValue(row, "Agent Target"),
      getRowValue(row, "Target"),
      getRowValue(row, "TARGET"),
      row?.D,
      ...dynamicTargetKeys.map((key) => getRowValue(row, key)),
    ];
    let parsedTarget = rawTargetCandidates
      .map((value) => parseTargetNumber(value))
      .find((value) => Number.isFinite(value) && value > 0);
    if (!parsedTarget) {
      for (const key of Object.keys(row || {})) {
        if (!isLikelyAgentTargetKey(key)) {
          continue;
        }
        const parsed = parseTargetNumber(getRowValue(row, key));
        if (Number.isFinite(parsed) && parsed > 0) {
          parsedTarget = parsed;
          break;
        }
      }
    }
    if (!parsedTarget) {
      continue;
    }
    const sourceMonthKey = String(row?.__sourceMonthKey || "").trim();
    const parsedDate = parseDateValue(getRowValue(row, leadDateField) || getRowValue(row, createdField));
    const monthKeyFromDate = parsedDate
      ? `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, "0")}`
      : "";
    const monthKey = sourceMonthKey || monthKeyFromDate || "__single__";
    if (!targetByAgentByMonth.has(normalizedAgent)) {
      targetByAgentByMonth.set(normalizedAgent, new Map());
    }
    const monthMap = targetByAgentByMonth.get(normalizedAgent);
    const currentMonthTarget = Number(monthMap.get(monthKey) || 0);
    if (parsedTarget > currentMonthTarget) {
      monthMap.set(monthKey, parsedTarget);
    }
  }
  for (const [normalizedAgent, monthMap] of targetByAgentByMonth.entries()) {
    let totalTarget = 0;
    for (const targetValue of monthMap.values()) {
      totalTarget += Number(targetValue || 0);
    }
    if (totalTarget > 0) {
      targetByAgent.set(normalizedAgent, totalTarget);
    }
  }
  return targetByAgent;
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
  const onlyWorkingAgents = Boolean(scope.onlyWorkingAgents);
  const restrictToRows = Boolean(scope.restrictToRows);
  const officeAgentMap = onlyWorkingAgents ? infoContext?.officeAgents : infoContext?.officeAgentsAll;
  const teamLeaderAgentMap = onlyWorkingAgents ? infoContext?.teamLeaderAgents : infoContext?.teamLeaderAgentsAll;
  const defaultAgents = onlyWorkingAgents ? infoContext?.agents : infoContext?.allAgents;
  const workingAgentsSet = new Set(infoContext?.agents || []);
  const normalizedOffices = normalizedFilterValues(scope.office || filters.office);
  const normalizedTeamLeaders = normalizedFilterValues(scope.teamLeader || filters.teamLeader);
  const normalizedAgents = normalizedFilterValues(scope.agent || filters.agent, normalizeAgentName);
  const rowAgents = agentsFromRows(rows, tabConfig);

  if (normalizedAgents.length) {
    for (const agent of normalizedAgents) {
      candidates.add(agent);
    }
  } else if (normalizedTeamLeaders.length) {
    for (const teamLeader of normalizedTeamLeaders) {
      const mapped = teamLeaderAgentMap?.get(teamLeader);
      if (!mapped) {
        continue;
      }
      for (const agent of mapped) {
        candidates.add(agent);
      }
    }
  } else if (normalizedOffices.length) {
    for (const office of normalizedOffices) {
      const mapped = officeAgentMap?.get(office);
      if (!mapped) {
        continue;
      }
      for (const agent of mapped) {
        candidates.add(agent);
      }
    }
  } else if (scope.groupField === "office") {
    for (const agent of defaultAgents || []) {
      candidates.add(agent);
    }
  } else if (scope.groupField === "teamLeader") {
    for (const agent of defaultAgents || []) {
      candidates.add(agent);
    }
  } else if (scope.groupField === "agentNames") {
    if (restrictToRows) {
      for (const agent of rowAgents) {
        if (onlyWorkingAgents && workingAgentsSet.size && !workingAgentsSet.has(agent)) {
          continue;
        }
        candidates.add(agent);
      }
    } else {
      for (const agent of defaultAgents || []) {
        candidates.add(agent);
      }
    }
  } else {
    if (restrictToRows) {
      for (const agent of rowAgents) {
        if (onlyWorkingAgents && workingAgentsSet.size && !workingAgentsSet.has(agent)) {
          continue;
        }
        candidates.add(agent);
      }
    } else {
      for (const agent of defaultAgents || []) {
        candidates.add(agent);
      }
    }
  }

  // Always add agents present in filtered rows so unmapped agents are still visible in validation.
  for (const agent of rowAgents) {
    if (onlyWorkingAgents && workingAgentsSet.size && !workingAgentsSet.has(agent)) {
      continue;
    }
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
  const rowTargetByAgent = buildRowTargetByAgent(rows, tabConfig);
  const preferRowTargets = Boolean(scope.preferRowTargets);
  const preferInfoTargets = Boolean(scope.preferInfoTargets);
  const candidateAgents = candidateAgentsByScope(infoContext, rows, tabConfig, filters, scope);
  const details = [];
  let includedTarget = 0;
  let totalFtd = 0;

  for (const normalizedName of candidateAgents) {
    const record = infoContext?.byAgent?.get(normalizedName) || null;
    const rowTarget = Number(rowTargetByAgent.get(normalizedName) || 0);
    const infoTarget = Number(record?.target || 0);
    const target = preferRowTargets ? rowTarget : preferInfoTargets ? infoTarget || rowTarget || 0 : rowTarget || infoTarget || 0;
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
