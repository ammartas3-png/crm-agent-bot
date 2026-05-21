import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getTabConfig } from "../config/sheetsConfig.js";
import {
  getFieldName,
  getFtdRowsByDateRange,
  getRowValue,
  isPresent,
  normalizeText,
} from "./calculations.js";
import { readSheetRows } from "./googleSheets.js";
import { currentMonthKey, getMonthFile, listMonthFiles } from "./monthlyReports.js";
import {
  buildInfoAgentsContext,
  includedTargetForStatus,
  normalizeAgentName,
} from "./targets.js";

const DEFAULT_INVALID_COUNTRIES = new Set(["", "-", "n/a", "na", "unknown", "null"]);
const DEFAULT_FILTERED_STATUSES = new Set(["test", "invalid", "spam", "duplicate"]);

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function isEmptyCell(value) {
  return String(value ?? "").trim() === "";
}

function isEmptyRow(row = {}) {
  return Object.values(row).every((value) => isEmptyCell(value));
}

function detectSpreadsheetContext(now = new Date()) {
  const activeCurrentMonth = getMonthFile(currentMonthKey(now), { includeInactive: false });
  const firstActive = listMonthFiles()[0] || null;
  const selected = activeCurrentMonth || firstActive;
  return {
    monthKey: selected?.key || "",
    monthLabel: selected?.month_label || "Unknown Month",
    spreadsheetId: selected?.sheet_id || "",
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...body].join("\n");
}

function mapFtdByAgent(rows, tabConfig) {
  const ftdMakerField = getFieldName(tabConfig, "ftdMaker");
  const agentField = getFieldName(tabConfig, "agentNames");
  const ftdRows = getFtdRowsByDateRange(rows, tabConfig, {}, new Date());
  const ftdByAgent = new Map();
  for (const row of ftdRows) {
    if (!isPresent(getRowValue(row, ftdMakerField))) {
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

function buildTargetDebugRows(rows, tabConfig, infoContext) {
  const agentField = getFieldName(tabConfig, "agentNames");
  const countryField = getFieldName(tabConfig, "country");
  const campaignField = getFieldName(tabConfig, "campaign");
  const ftdByAgent = mapFtdByAgent(rows, tabConfig);
  const leadAgents = new Set();
  const hasCountryByAgent = new Set();
  const hasCampaignByAgent = new Set();

  for (const row of rows) {
    const normalizedAgent = normalizeAgentName(getRowValue(row, agentField));
    if (!normalizedAgent) {
      continue;
    }
    leadAgents.add(normalizedAgent);
    if (String(getRowValue(row, countryField) || "").trim()) {
      hasCountryByAgent.add(normalizedAgent);
    }
    if (String(getRowValue(row, campaignField) || "").trim()) {
      hasCampaignByAgent.add(normalizedAgent);
    }
  }

  const allAgents = new Set([...infoContext.allAgents, ...leadAgents]);
  const rowsForExport = [];
  for (const normalizedName of allAgents) {
    const info = infoContext.byAgent.get(normalizedName);
    const ftd = ftdByAgent.get(normalizedName) || 0;
    const target = info?.target || 0;
    const includedTarget = includedTargetForStatus({
      working_status: info?.working_status || "",
      target,
      ftd,
    });
    rowsForExport.push({
      agent_name:
        info?.agent_name || infoContext.canonicalAgentByKey.get(normalizedName) || normalizedName,
      normalized_name: normalizedName,
      office: info?.office || "",
      team_leader: info?.team_leader || "",
      working_status: info?.working_status || "",
      target,
      ftd,
      included_target: includedTarget,
      included_in_summary: true,
      included_in_office: Boolean(info?.normalized_office),
      included_in_teamleader: Boolean(info?.normalized_team_leader),
      included_in_country: hasCountryByAgent.has(normalizedName),
      included_in_campaign: hasCampaignByAgent.has(normalizedName),
    });
  }

  rowsForExport.sort((left, right) => left.normalized_name.localeCompare(right.normalized_name));
  return rowsForExport;
}

function targetReconciliationWarnings(targetRows, infoContext) {
  const warnings = [];
  const summaryTarget = targetRows.reduce((sum, row) => sum + Number(row.included_target || 0), 0);

  const officeTotals = new Map();
  const teamLeaderTotals = new Map();
  const officeByTeamLeader = new Map();
  for (const row of targetRows) {
    if (row.included_in_office) {
      const officeKey = normalized(row.office);
      officeTotals.set(officeKey, (officeTotals.get(officeKey) || 0) + Number(row.included_target || 0));
    }
    if (row.included_in_teamleader) {
      const teamLeaderKey = normalized(row.team_leader);
      teamLeaderTotals.set(
        teamLeaderKey,
        (teamLeaderTotals.get(teamLeaderKey) || 0) + Number(row.included_target || 0),
      );
      if (!officeByTeamLeader.has(teamLeaderKey)) {
        officeByTeamLeader.set(teamLeaderKey, normalized(row.office));
      }
    }
  }

  const officeTargetSum = [...officeTotals.values()].reduce((sum, value) => sum + value, 0);
  if (officeTargetSum !== summaryTarget) {
    warnings.push(
      `Sum(office targets) ${officeTargetSum} != summary target ${summaryTarget}.`,
    );
  }

  for (const [office, officeTarget] of officeTotals.entries()) {
    const teamLeaderTotal = [...teamLeaderTotals.entries()]
      .filter(([teamLeader]) => officeByTeamLeader.get(teamLeader) === office)
      .reduce((sum, [, value]) => sum + value, 0);
    if (teamLeaderTotal !== officeTarget) {
      warnings.push(
        `Sum(team leader targets) ${teamLeaderTotal} != office target ${officeTarget} for office ${
          infoContext.canonicalOfficeByKey.get(office) || office
        }.`,
      );
    }
  }

  for (const [teamLeader, teamLeaderTarget] of teamLeaderTotals.entries()) {
    const agentTotal = targetRows
      .filter((row) => normalized(row.team_leader) === teamLeader)
      .reduce((sum, row) => sum + Number(row.included_target || 0), 0);
    if (agentTotal !== teamLeaderTarget) {
      warnings.push(
        `Sum(agent targets) ${agentTotal} != team leader target ${teamLeaderTarget} for ${
          infoContext.canonicalTeamLeaderByKey.get(teamLeader) || teamLeader
        }.`,
      );
    }
  }

  if (infoContext.duplicateNormalizedAgents.length) {
    warnings.push(
      `Duplicate normalized agents detected: ${infoContext.duplicateNormalizedAgents
        .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
        .join(", ")}`,
    );
  }
  if (infoContext.multiOfficeAgents.length) {
    warnings.push(
      `Agents found in multiple offices (latest row applied): ${infoContext.multiOfficeAgents
        .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
        .join(", ")}`,
    );
  }
  if (infoContext.missingOfficeOrTeamLeaderAgents.length) {
    warnings.push(
      `Missing office/team leader mapping: ${infoContext.missingOfficeOrTeamLeaderAgents
        .map((item) => infoContext.canonicalAgentByKey.get(item) || item)
        .join(", ")}`,
    );
  }

  return {
    warnings,
    summary_target: summaryTarget,
    office_target_sum: officeTargetSum,
    teamleader_target_sum: [...teamLeaderTotals.values()].reduce((sum, value) => sum + value, 0),
  };
}

async function writeValidationCsvExports(issues, targetRows, options = {}) {
  const exportDir = options.exportDir || path.join(os.tmpdir(), "crm-agent-bot-validation");
  await mkdir(exportDir, { recursive: true });

  const leadsPath = path.join(exportDir, "validation_leads.csv");
  const ftdPath = path.join(exportDir, "validation_ftd.csv");
  const agentsPath = path.join(exportDir, "validation_agents.csv");

  await writeFile(
    leadsPath,
    toCsv(issues.leads, [
      "issue",
      "row_number",
      "id",
      "country",
      "status",
      "different_month",
      "agent",
      "details",
    ]),
    "utf8",
  );
  await writeFile(
    ftdPath,
    toCsv(issues.ftd, ["issue", "row_number", "id", "ftd_maker", "ftd_date", "duplicate_key", "details"]),
    "utf8",
  );
  await writeFile(
    agentsPath,
    toCsv(targetRows, [
      "agent_name",
      "normalized_name",
      "office",
      "team_leader",
      "working_status",
      "target",
      "ftd",
      "included_target",
      "included_in_summary",
      "included_in_office",
      "included_in_teamleader",
      "included_in_country",
      "included_in_campaign",
    ]),
    "utf8",
  );

  return {
    validation_leads: leadsPath,
    validation_ftd: ftdPath,
    validation_agents: agentsPath,
  };
}

export function validateTotals(rows = [], tabConfig, infoAgentRows = [], options = {}) {
  const idField = getFieldName(tabConfig, "id");
  const countryField = getFieldName(tabConfig, "country");
  const differentMonthField = getFieldName(tabConfig, "differentMonth");
  const statusField = getFieldName(tabConfig, "status");
  const ftdMakerField = getFieldName(tabConfig, "ftdMaker");
  const ftdDateField = getFieldName(tabConfig, "ftdDate");
  const agentField = getFieldName(tabConfig, "agentNames");

  const invalidCountries = options.invalidCountries || DEFAULT_INVALID_COUNTRIES;
  const filteredStatuses = options.filteredStatuses || DEFAULT_FILTERED_STATUSES;

  const infoContext = buildInfoAgentsContext(infoAgentRows);
  const idRows = new Map();
  const ftdRowsByKey = new Map();
  const issues = {
    leads: [],
    ftd: [],
    agents: [],
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const id = String(getRowValue(row, idField) || "").trim();
    const country = String(getRowValue(row, countryField) || "").trim();
    const differentMonth = String(getRowValue(row, differentMonthField) || "").trim();
    const status = String(getRowValue(row, statusField) || "").trim();
    const ftdMaker = String(getRowValue(row, ftdMakerField) || "").trim();
    const ftdDate = String(getRowValue(row, ftdDateField) || "").trim();
    const agent = String(getRowValue(row, agentField) || "").trim();

    if (isEmptyRow(row)) {
      issues.leads.push({
        issue: "empty_row",
        row_number: rowNumber,
        id,
        country,
        status,
        different_month: differentMonth,
        agent,
        details: "Row has no usable values.",
      });
    }

    const normalizedId = normalized(id);
    if (normalizedId) {
      if (!idRows.has(normalizedId)) {
        idRows.set(normalizedId, []);
      }
      idRows.get(normalizedId).push({ rowNumber, id, country, status, differentMonth, agent });
    }

    if (invalidCountries.has(normalized(country))) {
      issues.leads.push({
        issue: "invalid_country_exclusion",
        row_number: rowNumber,
        id,
        country,
        status,
        different_month: differentMonth,
        agent,
        details: "Country excluded by reconciliation validation.",
      });
    }

    if (isPresent(differentMonth)) {
      issues.leads.push({
        issue: "different_month_exclusion",
        row_number: rowNumber,
        id,
        country,
        status,
        different_month: differentMonth,
        agent,
        details: "Different month marker found.",
      });
    }

    if (filteredStatuses.has(normalized(status))) {
      issues.leads.push({
        issue: "filtered_status",
        row_number: rowNumber,
        id,
        country,
        status,
        different_month: differentMonth,
        agent,
        details: "Status is part of filtered reconciliation statuses.",
      });
    }

    if (agent) {
      const normalizedAgent = normalizeAgentName(agent);
      const target = infoContext.targetsByAgent.get(normalizedAgent) || 0;
      if (target <= 0) {
        issues.agents.push({
          issue: "missing_target",
          row_number: rowNumber,
          agent,
          normalized_agent: normalizedAgent,
          target,
          canonical_agent: infoContext.canonicalAgentByKey.get(normalizedAgent) || "",
          details: "Agent target is empty or missing.",
        });
      }
      const canonicalAgent = infoContext.canonicalAgentByKey.get(normalizedAgent) || "";
      if (canonicalAgent && canonicalAgent !== agent.trim()) {
        issues.agents.push({
          issue: "agent_normalization_mismatch",
          row_number: rowNumber,
          agent,
          normalized_agent: normalizedAgent,
          target,
          canonical_agent: canonicalAgent,
          details: "Agent raw value differs from normalized catalog entry.",
        });
      }
    }

    if (isPresent(ftdMaker)) {
      const duplicateKey = normalizedId
        ? `id:${normalizedId}`
        : `fallback:${normalized(ftdMaker)}|${normalized(ftdDate)}|${normalized(country)}`;
      if (!ftdRowsByKey.has(duplicateKey)) {
        ftdRowsByKey.set(duplicateKey, []);
      }
      ftdRowsByKey.get(duplicateKey).push({
        rowNumber,
        id,
        ftdMaker,
        ftdDate,
        duplicateKey,
      });
    }
  });

  for (const [, duplicateRows] of idRows.entries()) {
    if (duplicateRows.length <= 1) {
      continue;
    }
    for (const duplicate of duplicateRows) {
      issues.leads.push({
        issue: "duplicate_id",
        row_number: duplicate.rowNumber,
        id: duplicate.id,
        country: duplicate.country,
        status: duplicate.status,
        different_month: duplicate.differentMonth,
        agent: duplicate.agent,
        details: `Duplicate ID appears ${duplicateRows.length} times.`,
      });
    }
  }

  for (const [key, duplicateRows] of ftdRowsByKey.entries()) {
    if (duplicateRows.length <= 1) {
      continue;
    }
    for (const duplicate of duplicateRows) {
      issues.ftd.push({
        issue: "duplicate_ftd",
        row_number: duplicate.rowNumber,
        id: duplicate.id,
        ftd_maker: duplicate.ftdMaker,
        ftd_date: duplicate.ftdDate,
        duplicate_key: key,
        details: `Duplicate FTD key appears ${duplicateRows.length} times.`,
      });
    }
  }

  const targetRows = buildTargetDebugRows(rows, tabConfig, infoContext);
  const targetReconciliation = targetReconciliationWarnings(targetRows, infoContext);

  return {
    issues,
    targetRows,
    targetReconciliation,
    summary: {
      lead_rows_total: rows.length,
      duplicate_ids: issues.leads.filter((item) => item.issue === "duplicate_id").length,
      invalid_country_exclusions: issues.leads.filter((item) => item.issue === "invalid_country_exclusion").length,
      different_month_exclusions: issues.leads.filter((item) => item.issue === "different_month_exclusion").length,
      empty_rows: issues.leads.filter((item) => item.issue === "empty_row").length,
      filtered_statuses: issues.leads.filter((item) => item.issue === "filtered_status").length,
      duplicate_ftd: issues.ftd.filter((item) => item.issue === "duplicate_ftd").length,
      missing_targets: issues.agents.filter((item) => item.issue === "missing_target").length,
      normalization_mismatches: issues.agents.filter((item) => item.issue === "agent_normalization_mismatch").length,
      summary_target: targetReconciliation.summary_target,
      office_target_sum: targetReconciliation.office_target_sum,
      teamleader_target_sum: targetReconciliation.teamleader_target_sum,
      target_warnings_count: targetReconciliation.warnings.length,
    },
  };
}

export async function buildDebugTotalsReport(options = {}) {
  const now = options.now || new Date();
  const leadsTabConfig = options.leadsTabConfig || getTabConfig("leads");
  const infoAgentsTabConfig = options.infoAgentsTabConfig || getTabConfig("infoAgents");
  const readRows = options.readRows || readSheetRows;
  const context = options.context || detectSpreadsheetContext(now);

  const rows = await readRows("leads", {
    tabConfig: leadsTabConfig,
    ...(context.spreadsheetId ? { spreadsheetId: context.spreadsheetId } : {}),
  });
  let infoAgentRows = [];
  try {
    infoAgentRows = await readRows("infoAgents", {
      tabConfig: infoAgentsTabConfig,
      ...(context.spreadsheetId ? { spreadsheetId: context.spreadsheetId } : {}),
    });
  } catch {
    infoAgentRows = [];
  }

  const invalidCountries = new Set(
    String(process.env.DEBUG_INVALID_COUNTRIES || "")
      .split(",")
      .map(normalized)
      .filter(Boolean),
  );
  const filteredStatuses = new Set(
    String(process.env.DEBUG_FILTERED_STATUSES || "")
      .split(",")
      .map(normalized)
      .filter(Boolean),
  );

  const validation = validateTotals(rows, leadsTabConfig, infoAgentRows, {
    invalidCountries: invalidCountries.size ? invalidCountries : DEFAULT_INVALID_COUNTRIES,
    filteredStatuses: filteredStatuses.size ? filteredStatuses : DEFAULT_FILTERED_STATUSES,
  });

  const exports = await writeValidationCsvExports(validation.issues, validation.targetRows, options);
  return {
    month_label: context.monthLabel,
    spreadsheet_id: context.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || "",
    summary: validation.summary,
    target_warnings: validation.targetReconciliation.warnings,
    exports,
  };
}

export function formatDebugTotalsReport(report) {
  return [
    "Reconciliation Validation",
    `Month: ${report.month_label}`,
    `Spreadsheet: ${report.spreadsheet_id || "-"}`,
    "",
    "Lead Validation",
    `- Lead Rows: ${report.summary.lead_rows_total}`,
    `- Duplicate IDs: ${report.summary.duplicate_ids}`,
    `- Invalid Country Exclusions: ${report.summary.invalid_country_exclusions}`,
    `- Different Month Exclusions: ${report.summary.different_month_exclusions}`,
    `- Empty Rows: ${report.summary.empty_rows}`,
    `- Filtered Statuses: ${report.summary.filtered_statuses}`,
    "",
    "FTD Validation",
    `- Duplicate FTD: ${report.summary.duplicate_ftd}`,
    "",
    "Target Validation",
    `- Missing Targets: ${report.summary.missing_targets}`,
    `- Agent Normalization Mismatches: ${report.summary.normalization_mismatches}`,
    `- Summary Included Target: ${report.summary.summary_target}`,
    `- Office Included Target Sum: ${report.summary.office_target_sum}`,
    `- Team Leader Included Target Sum: ${report.summary.teamleader_target_sum}`,
    "",
    ...(report.target_warnings.length
      ? ["Warnings:", ...report.target_warnings.map((warning) => `- ${warning}`), ""]
      : ["Warnings: none", ""]),
    "CSV Exports",
    `- validation_leads.csv: ${report.exports.validation_leads}`,
    `- validation_ftd.csv: ${report.exports.validation_ftd}`,
    `- validation_agents.csv: ${report.exports.validation_agents}`,
  ].join("\n");
}
