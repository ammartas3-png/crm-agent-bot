"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./details.module.css";
import { sortBuilderRows } from "../../../lib/pivotSort.js";

const MULTI_VALUE_KEYS = new Set([
  "monthKey",
  "officeScope",
  "date",
  "hour",
  "desk",
  "country",
  "brand",
  "campaign",
  "subCampaign",
  "placement",
  "status",
  "teamLeader",
  "agent",
  "rowDimensions",
  "metricFields",
  "totalDimensions",
]);

const ENTITY_LABELS = {
  desk: "Desk",
  teamLeader: "Team Leader",
  agent: "Agent",
};

const LINKABLE_FIELDS = [
  "date",
  "hour",
  "country",
  "brand",
  "campaign",
  "subCampaign",
  "placement",
  "status",
  "department",
  "desk",
  "teamLeader",
  "agent",
];

const LAST4_MATRIX_METRICS = [
  { key: "ftd", label: "FTD", type: "number" },
  { key: "ftdTarget", label: "FTD Target", type: "number" },
  { key: "ftdTargetReach", label: "FTD Target Reach", type: "percent" },
  { key: "cr", label: "CR", type: "percent" },
  { key: "crTarget", label: "CR Target", type: "percent" },
  { key: "crTargetReach", label: "CR Target Reach", type: "percent" },
];

const LAST4_MONTH_BLOCK_THEMES = [
  { header: "#1d4ed8", light: "#dbeafe", text: "#ffffff" },
  { header: "#7c3aed", light: "#ede9fe", text: "#ffffff" },
  { header: "#c2410c", light: "#ffedd5", text: "#ffffff" },
  { header: "#0f766e", light: "#ccfbf1", text: "#ffffff" },
];

function parseList(rawValue = "") {
  return String(rawValue || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseBoolean(rawValue = "") {
  return ["1", "true", "yes", "on"].includes(String(rawValue || "").trim().toLowerCase());
}

function normalizedDetailsValue(value = "") {
  return String(value || "")
    .replace(/\s+total$/i, "")
    .trim();
}

function parseFiltersFromSearchParams(searchParams) {
  const payload = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === "detailsEntity" || key === "detailsValue" || key === "detailsLabel" || key === "contextKey") {
      continue;
    }
    if (MULTI_VALUE_KEYS.has(key)) {
      payload[key] = parseList(value);
      continue;
    }
    if (["includeWorkTime", "hideNotWorking", "benchmarkMode"].includes(key)) {
      payload[key] = parseBoolean(value);
      continue;
    }
    payload[key] = String(value || "").trim();
  }
  return payload;
}

function linkedFiltersFromRow(row = {}) {
  const next = {};
  for (const key of LINKABLE_FIELDS) {
    const value = normalizedDetailsValue(String(row?.[key] || "").trim());
    if (!hasMeaningfulValue(value)) {
      continue;
    }
    next[key] = [value];
  }
  return next;
}

function filterValueText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDateValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const token = text.split(/[ T]/)[0] || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    return token;
  }
  let matched = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (matched) {
    const day = String(Number(matched[1] || 0)).padStart(2, "0");
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const year = String(Number(matched[3] || 0));
    return `${year}-${month}-${day}`;
  }
  matched = token.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (matched) {
    const year = String(Number(matched[1] || 0));
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const day = String(Number(matched[3] || 0)).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  matched = token.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (matched) {
    const day = String(Number(matched[1] || 0)).padStart(2, "0");
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const year = String(Number(matched[3] || 0));
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function normalizeHourValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const matched = text.match(/^(\d{1,2})(?::\d{2})?/);
  if (!matched) {
    return "";
  }
  const hour = Number(matched[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return "";
  }
  return String(hour).padStart(2, "0");
}

function createdDatePart(value = "") {
  return normalizeDateValue(value);
}

function createdHourPart(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const matched = text.match(/\b(\d{2}):\d{2}(?::\d{2})?\b/);
  return matched ? matched[1] : "";
}

function rowMatchesLinkedFilters(row = {}, linkedFilters = {}) {
  const entries = Object.entries(linkedFilters || {});
  if (!entries.length) {
    return true;
  }
  return entries.every(([key, values]) => {
    const expectedValues = (Array.isArray(values) ? values : [values])
      .map((value) => {
        if (key === "date") {
          return normalizeDateValue(value);
        }
        if (key === "hour") {
          return normalizeHourValue(value);
        }
        return filterValueText(value);
      })
      .filter(Boolean);
    if (!expectedValues.length) {
      return true;
    }
    const candidateValues = new Set();
    const direct =
      key === "date" ? normalizeDateValue(row?.[key]) : key === "hour" ? normalizeHourValue(row?.[key]) : filterValueText(row?.[key]);
    if (direct) {
      candidateValues.add(direct);
    }
    if (key === "date") {
      const createdDate = filterValueText(createdDatePart(row?.created));
      if (createdDate) {
        candidateValues.add(createdDate);
      }
    }
    if (key === "hour") {
      const createdHour = normalizeHourValue(createdHourPart(row?.created));
      if (createdHour) {
        candidateValues.add(createdHour);
      }
    }
    if (!candidateValues.size) {
      return true;
    }
    return expectedValues.some((expected) => candidateValues.has(expected));
  });
}

function applyLinkedFiltersToReport(report = null, linkedFilters = {}) {
  if (!report || !Array.isArray(report?.table)) {
    return report;
  }
  const entries = Object.entries(linkedFilters || {});
  if (!entries.length) {
    return report;
  }
  const detailRows = report.table.filter((row) => row?.__rowKind !== "total");
  const filteredRows = detailRows.filter((row) => rowMatchesLinkedFilters(row, linkedFilters));
  return {
    ...report,
    table: filteredRows,
  };
}

function resolveBestGroupKey(rows = [], columns = [], requestedKey = "") {
  const candidateKeys = [
    String(requestedKey || "").trim(),
    ...columns.map((column) => String(column?.key || "").trim()),
  ].filter(Boolean);
  for (const key of candidateKeys) {
    const distinct = new Set(
      rows
        .map((row) => String(row?.[key] || "").trim())
        .filter((value) => hasMeaningfulValue(value)),
    );
    if (distinct.size > 1) {
      return key;
    }
  }
  return String(requestedKey || columns[0]?.key || "").trim();
}

function buildReportQuery(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (typeof value === "boolean") {
      if (value) {
        query.set(key, "1");
      }
      continue;
    }
    const normalized = Array.isArray(value)
      ? value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .join(",")
      : String(value || "").trim();
    if (normalized) {
      query.set(key, normalized);
    }
  }
  return query;
}

async function readApiPayload(response) {
  const rawText = await response.text();
  if (!rawText) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    const snippet = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      ok: false,
      error: "invalid_json_response",
      message: snippet ? `Server returned non-JSON response: ${snippet}` : "Server returned non-JSON response.",
    };
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDecimal(value, digits = 2) {
  const numeric = Number(value || 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return safe.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function parseMaybeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasMeaningfulValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && normalized !== "-" && normalized !== "—" && normalized !== "n/a";
}

function formatCellValue(column = {}, value) {
  if (column.type === "number") {
    return formatNumber(value);
  }
  if (column.type === "percent") {
    return formatPercent(value);
  }
  return String(value || "-");
}

function tableCellStyle(column = {}, value) {
  const keyLower = String(column.key || "").toLowerCase();
  const isTargetReach = keyLower.includes("targetreach");
  if (isTargetReach) {
    return reachCellStyle(value);
  }
  if (keyLower === "ftdbenchmarkrate") {
    return benchmarkRateCellStyle(value);
  }
  if (keyLower === "workcurrentstatus") {
    return statusCellStyle(value);
  }
  return null;
}

function buildCollapsedGroupSummaryRow(rows = [], columns = [], groupByKey = "", groupLabel = "") {
  const sumBy = (key = "") =>
    rows.reduce((sum, row) => {
      const numeric = parseMaybeNumber(row?.[key]);
      return sum + (numeric ?? 0);
    }, 0);
  const averageBy = (key = "") => {
    const values = rows.map((row) => parseMaybeNumber(row?.[key])).filter((value) => value !== null);
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const leadsSum = sumBy("leads");
  const ftdSum = sumBy("ftd");
  const ftdTargetSum = sumBy("ftdTarget");
  const weightedCrTarget =
    leadsSum > 0
      ? rows.reduce((sum, row) => {
          const crTarget = parseMaybeNumber(row?.crTarget) ?? 0;
          const leads = parseMaybeNumber(row?.leads) ?? 0;
          return sum + crTarget * leads;
        }, 0) / leadsSum
      : 0;
  const summary = {};
  for (const column of columns) {
    const key = String(column.key || "");
    const keyLower = key.toLowerCase();
    if (key === groupByKey) {
      summary[key] = groupLabel ? `${groupLabel} Total` : "Total";
      continue;
    }
    if (column.type === "number") {
      summary[key] = sumBy(key);
      continue;
    }
    if (column.type === "percent") {
      if (keyLower === "cr" && leadsSum > 0) {
        summary[key] = (ftdSum / leadsSum) * 100;
        continue;
      }
      if (keyLower === "ftdtargetreach" && ftdTargetSum > 0) {
        summary[key] = (ftdSum / ftdTargetSum) * 100;
        continue;
      }
      if (keyLower === "crtargetreach") {
        const crValue = leadsSum > 0 ? (ftdSum / leadsSum) * 100 : averageBy("cr");
        const crTarget = weightedCrTarget > 0 ? weightedCrTarget : averageBy("crTarget");
        summary[key] = crTarget > 0 ? (crValue / crTarget) * 100 : averageBy(key);
        continue;
      }
      summary[key] = averageBy(key);
      continue;
    }
    const uniqueValues = [...new Set(rows.map((row) => String(row?.[key] || "").trim()).filter(hasMeaningfulValue))];
    summary[key] = uniqueValues.length === 1 ? uniqueValues[0] : "-";
  }
  return summary;
}

function shortMonthLabel(monthKey = "", fallbackLabel = "") {
  const matched = String(monthKey || "")
    .trim()
    .match(/^(\d{4})-(\d{2})$/);
  if (!matched) {
    return String(fallbackLabel || monthKey || "");
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return String(fallbackLabel || monthKey || "");
  }
  const shortMonth = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${shortMonth}-${String(year).slice(-2)}`;
}

function Last4MonthsMatrixTable({
  title = "Last 4 Months Results",
  monthRows = [],
  deskLabel = "-",
  teamLeaderLabel = "-",
  agentLabel = "-",
  tableId = "",
  onSelectRow = null,
  selectedRowKey = "",
}) {
  const months = useMemo(
    () =>
      (Array.isArray(monthRows) ? monthRows : []).map((item) => {
        const summary = item?.summary || {};
        return {
          key: String(item?.monthKey || ""),
          label: shortMonthLabel(item?.monthKey || "", item?.monthLabel || item?.monthKey || ""),
          metrics: {
            ftd: Number(summary.totalFtd || summary.ftd || 0),
            ftdTarget: Number(summary.ftdTarget || 0),
            ftdTargetReach: Number(summary.ftdTargetReach || 0),
            cr: Number(summary.cr || 0),
            crTarget: Number(summary.crTarget || 0),
            crTargetReach: Number(summary.crTargetReach || 0),
          },
        };
      }),
    [monthRows],
  );
  const hasMonths = months.length > 0;
  const rowPayload = {
    desk: deskLabel,
    teamLeader: teamLeaderLabel,
    agent: agentLabel,
  };
  const rowKey = `${tableId || "last4-matrix"}:context`;
  const isSelected = selectedRowKey === rowKey;

  return (
    <section className={styles.panel}>
      <div className={styles.tableHeaderRow}>
        <h2 className={styles.sectionTitle}>{title}</h2>
      </div>
      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.matrixTable}`}>
          <thead>
            <tr>
              <th rowSpan={2}>Desk</th>
              <th rowSpan={2}>Team Leader</th>
              <th rowSpan={2}>Agent</th>
              {months.map((month, monthIndex) => {
                const theme = LAST4_MONTH_BLOCK_THEMES[monthIndex % LAST4_MONTH_BLOCK_THEMES.length];
                return (
                  <th
                    key={`last4-group-${month.key || month.label || monthIndex}`}
                    colSpan={LAST4_MATRIX_METRICS.length}
                    style={{ background: theme.header, color: theme.text, textAlign: "center" }}
                  >
                    {month.label}
                  </th>
                );
              })}
            </tr>
            <tr>
              {months.flatMap((month, monthIndex) => {
                const theme = LAST4_MONTH_BLOCK_THEMES[monthIndex % LAST4_MONTH_BLOCK_THEMES.length];
                return LAST4_MATRIX_METRICS.map((metric) => (
                  <th
                    key={`last4-metric-${month.key || month.label}-${metric.key}`}
                    style={{ background: theme.light, color: "#0f172a" }}
                  >
                    {metric.label}
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            {hasMonths ? (
              <tr
                className={`${styles.selectableRow} ${isSelected ? styles.selectedRow : ""}`}
                onClick={() => onSelectRow?.(rowKey, rowPayload)}
              >
                <td>{deskLabel || "-"}</td>
                <td>{teamLeaderLabel || "-"}</td>
                <td>{agentLabel || "-"}</td>
                {months.flatMap((month) =>
                  LAST4_MATRIX_METRICS.map((metric) => {
                    const value = month.metrics?.[metric.key];
                    const style = metric.key.toLowerCase().includes("targetreach") ? reachCellStyle(value) : null;
                    return (
                      <td key={`last4-value-${month.key || month.label}-${metric.key}`} style={style || undefined}>
                        {metric.type === "percent" ? formatPercent(value) : formatNumber(value)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ) : (
              <tr>
                <td className={styles.emptyCell} colSpan={3}>
                  No month summary found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InteractiveDetailTable({
  title = "",
  report = null,
  columns: inputColumns = null,
  rows: inputRows = null,
  emptyMessage = "No rows found.",
  groupByKey = "",
  initialSortKey = "",
  tableId = "",
  onSelectRow = null,
  selectedRowKey = "",
  enableRowGroupCollapse = true,
  hierarchyKeys = [],
}) {
  const sourceColumns = useMemo(() => {
    if (Array.isArray(inputColumns) && inputColumns.length) {
      return inputColumns;
    }
    return Array.isArray(report?.builder?.columns) ? report.builder.columns : [];
  }, [inputColumns, report?.builder?.columns]);
  const sourceRows = useMemo(() => {
    if (Array.isArray(inputRows)) {
      return inputRows;
    }
    return Array.isArray(report?.table) ? report.table : [];
  }, [inputRows, report?.table]);
  const [sortState, setSortState] = useState({
    key: initialSortKey || sourceColumns[0]?.key || "",
    direction: "desc",
  });
  const [collapsedGroups, setCollapsedGroups] = useState({});

  useEffect(() => {
    if (!sourceColumns.length) {
      return;
    }
    if (!sourceColumns.some((column) => column.key === sortState.key)) {
      setSortState({ key: sourceColumns[0].key, direction: "desc" });
    }
  }, [sortState.key, sourceColumns]);

  const detailRows = useMemo(() => sourceRows.filter((row) => row?.__rowKind !== "total"), [sourceRows]);
  const totalRows = useMemo(() => sourceRows.filter((row) => row?.__rowKind === "total"), [sourceRows]);
  const hierarchySortKeys = useMemo(() => {
    const requested = Array.isArray(hierarchyKeys) && hierarchyKeys.length ? hierarchyKeys : [groupByKey];
    return requested
      .map((key) => String(key || "").trim())
      .filter((key) => key && sourceColumns.some((column) => column.key === key));
  }, [groupByKey, hierarchyKeys, sourceColumns]);
  const sortedDetailRows = useMemo(() => {
    const activeColumn = sourceColumns.find((column) => column.key === sortState.key);
    if (!activeColumn) {
      return detailRows;
    }
    return sortBuilderRows(detailRows, {
      hierarchyKeys: hierarchySortKeys,
      activeColumnKey: activeColumn.key,
      activeColumnType: activeColumn.type,
      direction: sortState.direction,
    });
  }, [detailRows, hierarchySortKeys, sortState.direction, sortState.key, sourceColumns]);
  const displayDetailRows = useMemo(() => sortedDetailRows.slice(0, 320), [sortedDetailRows]);
  const effectiveGroupKey = useMemo(
    () => resolveBestGroupKey(displayDetailRows, sourceColumns, groupByKey),
    [displayDetailRows, groupByKey, sourceColumns],
  );
  const groupedRows = useMemo(() => {
    if (!effectiveGroupKey) {
      return new Map([["__all__", displayDetailRows]]);
    }
    const map = new Map();
    displayDetailRows.forEach((row) => {
      const label = String(row?.[effectiveGroupKey] || "-").trim() || "-";
      if (!map.has(label)) {
        map.set(label, []);
      }
      map.get(label).push(row);
    });
    return map;
  }, [displayDetailRows, effectiveGroupKey]);
  const groupLabels = [...groupedRows.keys()];
  const canGroupCollapse = Boolean(enableRowGroupCollapse) && groupLabels.length > 1;
  const groupSignature = useMemo(() => groupLabels.join("||"), [groupLabels]);
  const allGroupsCollapsed = canGroupCollapse && groupLabels.every((label) => Boolean(collapsedGroups[label]));

  useEffect(() => {
    if (!canGroupCollapse) {
      setCollapsedGroups({});
      return;
    }
    setCollapsedGroups((previous) => {
      const next = Object.fromEntries(groupLabels.map((label) => [label, true]));
      const previousKeys = Object.keys(previous);
      if (
        previousKeys.length === groupLabels.length &&
        groupLabels.every((label) => previous[label] === true)
      ) {
        return previous;
      }
      return next;
    });
  }, [canGroupCollapse, groupSignature]);

  const toggleGroup = (label) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };
  const toggleAllGroups = () => {
    if (!canGroupCollapse) {
      return;
    }
    if (allGroupsCollapsed) {
      setCollapsedGroups({});
      return;
    }
    setCollapsedGroups(Object.fromEntries(groupLabels.map((label) => [label, true])));
  };
  const truncated = sortedDetailRows.length > displayDetailRows.length;

  return (
    <section className={styles.panel}>
      <div className={styles.tableHeaderRow}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <div className={styles.headerActions}>
          {truncated ? <span className={styles.inlineHint}>Showing first {displayDetailRows.length} rows</span> : null}
          {canGroupCollapse ? (
            <button type="button" className={styles.actionButton} onClick={toggleAllGroups}>
              {allGroupsCollapsed ? "Expand All Rows" : "Collapse All Rows"}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {sourceColumns.map((column) => {
                const active = sortState.key === column.key;
                const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={column.key}
                    onClick={() =>
                      setSortState((prev) =>
                        prev.key === column.key
                          ? { key: column.key, direction: prev.direction === "asc" ? "desc" : "asc" }
                          : { key: column.key, direction: column.type === "number" || column.type === "percent" ? "desc" : "asc" },
                      )
                    }
                    className={styles.sortableHeader}
                  >
                    {column.label}
                    {suffix}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {[...groupedRows.entries()].flatMap(([groupLabel, rows], groupIndex) => {
              const collapsed = canGroupCollapse ? Boolean(collapsedGroups[groupLabel]) : false;
              const collapseKey = sourceColumns.some((column) => column.key === effectiveGroupKey)
                ? effectiveGroupKey
                : sourceColumns[0]?.key || "";
              const collapsedSummary = buildCollapsedGroupSummaryRow(rows, sourceColumns, collapseKey, groupLabel);
              const collapsedRowKey = `${tableId || title}:collapsed:${groupLabel}`;
              const collapsedSelected = selectedRowKey === collapsedRowKey;
              const headerRow =
                canGroupCollapse
                  ? [
                      <tr key={`group-${title}-${groupLabel}-${groupIndex}`} className={styles.groupRow}>
                        <td colSpan={sourceColumns.length || 1}>
                          <button type="button" className={styles.groupButton} onClick={() => toggleGroup(groupLabel)}>
                            <span>{collapsed ? "▶" : "▼"}</span>
                            <span>{groupLabel}</span>
                          </button>
                        </td>
                      </tr>,
                    ]
                  : [];
              if (collapsed) {
                return [
                  <tr
                    key={`collapsed-${title}-${groupLabel}-${groupIndex}`}
                    className={`${styles.totalRow} ${styles.selectableRow} ${collapsedSelected ? styles.selectedRow : ""}`}
                    onClick={() => onSelectRow?.(collapsedRowKey, collapsedSummary)}
                  >
                    {sourceColumns.map((column) => {
                      const value = collapsedSummary[column.key];
                      const style = tableCellStyle(column, value);
                      const isToggleColumn = canGroupCollapse && column.key === collapseKey;
                      return (
                        <td key={`collapsed-${title}-${groupLabel}-${groupIndex}-${column.key}`} style={style || undefined}>
                          {isToggleColumn ? (
                            <button
                              type="button"
                              className={styles.groupButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleGroup(groupLabel);
                              }}
                            >
                              <span>▶</span>
                              <span>{String(value || `${groupLabel} Total`)}</span>
                            </button>
                          ) : (
                            formatCellValue(column, value)
                          )}
                        </td>
                      );
                    })}
                  </tr>,
                ];
              }
              const dataRows = rows.map((row, rowIndex) => {
                const rowKey = String(row.__rowKey || row.key || `${groupLabel}-${rowIndex}`);
                const compositeRowKey = `${tableId || title}:${rowKey}`;
                const isSelected = selectedRowKey === compositeRowKey;
                return (
                  <tr
                    key={rowKey}
                    className={`${styles.selectableRow} ${isSelected ? styles.selectedRow : ""}`}
                    onClick={() => onSelectRow?.(compositeRowKey, row)}
                  >
                    {sourceColumns.map((column) => {
                      const value = row[column.key];
                      const style = tableCellStyle(column, value);
                      return (
                        <td key={`${rowKey}-${column.key}`} style={style || undefined}>
                          {formatCellValue(column, value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              });
              return [...headerRow, ...dataRows];
            })}
            {totalRows.map((row, rowIndex) => {
              const rowKey = String(row.__rowKey || row.key || `total-${rowIndex}`);
              return (
                <tr key={rowKey} className={styles.totalRow}>
                  {sourceColumns.map((column) => {
                    const value = row[column.key];
                    const style = tableCellStyle(column, value);
                    return (
                      <td key={`${rowKey}-${column.key}`} style={style || undefined}>
                        {formatCellValue(column, value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!displayDetailRows.length && !totalRows.length ? (
              <tr>
                <td className={styles.emptyCell} colSpan={sourceColumns.length || 1}>
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooterActions}>
        {canGroupCollapse ? (
          <button type="button" className={styles.actionButton} onClick={toggleAllGroups}>
            {allGroupsCollapsed ? "Expand All Rows" : "Collapse All Rows"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function HierarchicalTrafficTable({
  title = "Traffic Report",
  report = null,
  groupKeys = ["country", "campaign", "subCampaign", "placement"],
  tableId = "traffic-report",
  onSelectRow = null,
  selectedRowKey = "",
}) {
  const sourceColumns = useMemo(
    () => (Array.isArray(report?.builder?.columns) ? report.builder.columns : []),
    [report?.builder?.columns],
  );
  const sourceRows = useMemo(() => (Array.isArray(report?.table) ? report.table : []), [report?.table]);
  const detailRows = useMemo(() => sourceRows.filter((row) => row?.__rowKind !== "total"), [sourceRows]);
  const totalRows = useMemo(() => sourceRows.filter((row) => row?.__rowKind === "total"), [sourceRows]);
  const activeGroupKeys = useMemo(
    () => groupKeys.filter((key) => sourceColumns.some((column) => column.key === key)),
    [groupKeys, sourceColumns],
  );
  const [sortState, setSortState] = useState({
    key: "leads",
    direction: "desc",
  });
  useEffect(() => {
    if (!sourceColumns.length) {
      return;
    }
    if (!sourceColumns.some((column) => column.key === sortState.key)) {
      setSortState({ key: sourceColumns[0].key, direction: "asc" });
    }
  }, [sortState.key, sourceColumns]);
  const sortedDetailRows = useMemo(() => {
    const activeColumn = sourceColumns.find((column) => column.key === sortState.key);
    if (!activeColumn) {
      return detailRows;
    }
    return sortBuilderRows(detailRows, {
      hierarchyKeys: activeGroupKeys,
      activeColumnKey: activeColumn.key,
      activeColumnType: activeColumn.type,
      direction: sortState.direction,
    });
  }, [activeGroupKeys, detailRows, sortState.direction, sortState.key, sourceColumns]);
  const displayRows = useMemo(() => sortedDetailRows.slice(0, 320), [sortedDetailRows]);
  const [collapsedPaths, setCollapsedPaths] = useState({});
  const groupPathsByDepth = useMemo(() => {
    const next = activeGroupKeys.map(() => []);
    const seen = activeGroupKeys.map(() => new Set());
    for (const row of displayRows) {
      const pathParts = [];
      activeGroupKeys.forEach((key, depth) => {
        const label = String(row?.[key] || "-").trim() || "-";
        pathParts.push(`${key}:${label}`);
        const pathKey = pathParts.join("||");
        if (!seen[depth].has(pathKey)) {
          seen[depth].add(pathKey);
          next[depth].push(pathKey);
        }
      });
    }
    return next;
  }, [activeGroupKeys, displayRows]);
  const allCollapsed = useMemo(
    () =>
      groupPathsByDepth.length > 0 &&
      groupPathsByDepth.every((paths) => paths.length > 0 && paths.every((pathKey) => Boolean(collapsedPaths[pathKey]))),
    [collapsedPaths, groupPathsByDepth],
  );
  useEffect(() => {
    if (!groupPathsByDepth.length) {
      setCollapsedPaths({});
      return;
    }
    setCollapsedPaths((prev) => {
      const next = {};
      groupPathsByDepth.forEach((paths) => {
        paths.forEach((pathKey) => {
          next[pathKey] = true;
        });
      });
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === true)) {
        return prev;
      }
      return next;
    });
  }, [groupPathsByDepth]);
  const togglePath = useCallback((pathKey) => {
    setCollapsedPaths((prev) => ({
      ...prev,
      [pathKey]: !prev[pathKey],
    }));
  }, []);
  const toggleAll = useCallback(() => {
    if (!groupPathsByDepth.length) {
      return;
    }
    if (allCollapsed) {
      setCollapsedPaths({});
      return;
    }
    const next = {};
    groupPathsByDepth.forEach((paths) => {
      paths.forEach((pathKey) => {
        next[pathKey] = true;
      });
    });
    setCollapsedPaths(next);
  }, [allCollapsed, groupPathsByDepth]);

  const renderDataRow = useCallback(
    (row = {}, fallbackKey = "") => {
      const rowKey = String(row?.__rowKey || row?.key || fallbackKey || "row");
      const compositeRowKey = `${tableId}:${rowKey}`;
      const isSelected = selectedRowKey === compositeRowKey;
      return (
        <tr
          key={compositeRowKey}
          className={`${styles.selectableRow} ${isSelected ? styles.selectedRow : ""}`}
          onClick={() => onSelectRow?.(compositeRowKey, row)}
        >
          {sourceColumns.map((column) => {
            const value = row?.[column.key];
            const style = tableCellStyle(column, value);
            return (
              <td key={`${compositeRowKey}-${column.key}`} style={style || undefined}>
                {formatCellValue(column, value)}
              </td>
            );
          })}
        </tr>
      );
    },
    [onSelectRow, selectedRowKey, sourceColumns, tableId],
  );

  const renderGroupedRows = useCallback(
    (rows = [], depth = 0, pathParts = []) => {
      if (depth >= activeGroupKeys.length) {
        return rows.map((row, index) => renderDataRow(row, `${pathParts.join("||")}::${index}`));
      }
      const key = activeGroupKeys[depth];
      const grouped = new Map();
      for (const row of rows) {
        const label = String(row?.[key] || "-").trim() || "-";
        if (!grouped.has(label)) {
          grouped.set(label, []);
        }
        grouped.get(label).push(row);
      }
      return [...grouped.entries()].flatMap(([label, groupRows]) => {
        const nextPathParts = [...pathParts, `${key}:${label}`];
        const pathKey = nextPathParts.join("||");
        const collapsed = Boolean(collapsedPaths[pathKey]);
        const summaryRow = buildCollapsedGroupSummaryRow(groupRows, sourceColumns, key, label);
        const summaryKey = `${tableId}:group:${pathKey}`;
        const summarySelected = selectedRowKey === summaryKey;
        const summaryNode = (
          <tr
            key={summaryKey}
            className={`${styles.totalRow} ${styles.selectableRow} ${summarySelected ? styles.selectedRow : ""}`}
            onClick={() => onSelectRow?.(summaryKey, summaryRow)}
            onDoubleClick={() => togglePath(pathKey)}
          >
            {sourceColumns.map((column) => {
              const value = summaryRow?.[column.key];
              const style = tableCellStyle(column, value);
              const isToggleCell = column.key === key;
              return (
                <td key={`${summaryKey}-${column.key}`} style={style || undefined}>
                  {isToggleCell ? (
                    <span className={styles.groupButton} style={{ cursor: "pointer", userSelect: "none" }}>
                      <span>{collapsed ? "▶" : "▼"}</span>
                      <span>{String(value || `${label} Total`)}</span>
                    </span>
                  ) : (
                    formatCellValue(column, value)
                  )}
                </td>
              );
            })}
          </tr>
        );
        if (collapsed) {
          return [summaryNode];
        }
        if (depth === activeGroupKeys.length - 1) {
          return [summaryNode, ...groupRows.map((row, index) => renderDataRow(row, `${pathKey}::${index}`))];
        }
        return [summaryNode, ...renderGroupedRows(groupRows, depth + 1, nextPathParts)];
      });
    },
    [activeGroupKeys.length, collapsedPaths, onSelectRow, renderDataRow, selectedRowKey, sourceColumns, tableId, togglePath],
  );

  if (!activeGroupKeys.length) {
    return (
      <InteractiveDetailTable
        title={title}
        report={report}
        emptyMessage="No traffic rows found."
        groupByKey="country"
        initialSortKey="leads"
        tableId={tableId}
        onSelectRow={onSelectRow}
        selectedRowKey={selectedRowKey}
      />
    );
  }

  const bodyRows = renderGroupedRows(displayRows, 0, []);
  const truncated = sortedDetailRows.length > displayRows.length;

  return (
    <section className={styles.panel}>
      <div className={styles.tableHeaderRow}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <div className={styles.headerActions}>
          {truncated ? <span className={styles.inlineHint}>Showing first {displayRows.length} rows</span> : null}
          <button type="button" className={styles.actionButton} onClick={toggleAll}>
            {allCollapsed ? "Expand All Rows" : "Collapse All Rows"}
          </button>
        </div>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {sourceColumns.map((column) => {
                const active = sortState.key === column.key;
                const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={column.key}
                    onClick={() =>
                      setSortState((prev) =>
                        prev.key === column.key
                          ? { key: column.key, direction: prev.direction === "asc" ? "desc" : "asc" }
                          : { key: column.key, direction: column.type === "number" || column.type === "percent" ? "desc" : "asc" },
                      )
                    }
                    className={styles.sortableHeader}
                  >
                    {column.label}
                    {suffix}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {bodyRows}
            {totalRows.map((row, rowIndex) => renderDataRow(row, `total-${rowIndex}`))}
            {!bodyRows.length && !totalRows.length ? (
              <tr>
                <td className={styles.emptyCell} colSpan={sourceColumns.length || 1}>
                  No traffic rows found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className={styles.tableFooterActions}>
        <button type="button" className={styles.actionButton} onClick={toggleAll}>
          {allCollapsed ? "Expand All Rows" : "Collapse All Rows"}
        </button>
      </div>
    </section>
  );
}

// In-cell progress bar (bullet) toward the 100% target, keeping the green/red
// status colour. Pure style change — markup and flow are unchanged.
function reachCellStyle(value) {
  const numeric = Number(value || 0);
  const fill = Math.max(0, Math.min(100, numeric));
  const isGood = numeric >= 100;
  const fillColor = isGood ? "#bbf7d0" : "#fecaca";
  const color = isGood ? "#166534" : "#b91c1c";
  return {
    background: `linear-gradient(90deg, ${fillColor} ${fill}%, #f1f5f9 ${fill}%)`,
    color,
    fontWeight: 700,
  };
}

function benchmarkRateCellStyle(value) {
  const numeric = Number(value || 0);
  const fill = Math.max(0, Math.min(100, numeric));
  let fillColor;
  let color;
  if (numeric >= 110) {
    fillColor = "#bbf7d0";
    color = "#166534";
  } else if (numeric >= 85) {
    fillColor = "#d9f99d";
    color = "#3f6212";
  } else if (numeric >= 60) {
    fillColor = "#fde68a";
    color = "#92400e";
  } else {
    fillColor = "#fecaca";
    color = "#b91c1c";
  }
  return {
    background: `linear-gradient(90deg, ${fillColor} ${fill}%, #f1f5f9 ${fill}%)`,
    color,
    fontWeight: 700,
  };
}

function statusCellStyle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "working") {
    return { background: "#16a34a", color: "#ffffff", fontWeight: 700 };
  }
  if (normalized && normalized !== "-") {
    return { background: "#ef4444", color: "#ffffff", fontWeight: 700 };
  }
  return null;
}

function BenchmarkFocusTable({
  title = "",
  report = null,
  groupByKey = "teamLeader",
  onSelectRow = null,
  selectedRowKey = "",
}) {
  const rows = Array.isArray(report?.table) ? report.table : [];
  const allColumns = Array.isArray(report?.builder?.columns) ? report.builder.columns : [];
  const preferredOrder = [
    "desk",
    "teamLeader",
    "agent",
    "ftd",
    "agentAvgFtdPerWorkedMonth",
    "avgFtdByDeskLongTerm",
    "ftdBenchmarkRate",
    "crTargetReach",
    "ftdTargetReach",
    "workStartDate",
    "workDays",
    "workMonths",
    "workLongTerm",
    "workCurrentStatus",
    "workExitDate",
  ];
  const preferredMap = new Map(preferredOrder.map((key, index) => [key, index]));
  const columns = useMemo(() => {
    const visible = allColumns.filter((column) =>
      rows.some((row) => {
        if (row?.__rowKind === "total") {
          return false;
        }
        const value = row?.[column.key];
        if (column.type === "number" || column.type === "percent") {
          return Number.isFinite(Number(value));
        }
        return hasMeaningfulValue(value);
      }),
    );
    return [...visible].sort((left, right) => {
      const leftIndex = preferredMap.has(left.key) ? preferredMap.get(left.key) : 999;
      const rightIndex = preferredMap.has(right.key) ? preferredMap.get(right.key) : 999;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return String(left.label || "").localeCompare(String(right.label || ""), "en", { sensitivity: "base" });
    });
  }, [allColumns, preferredMap, rows]);
  return (
    <InteractiveDetailTable
      title={title}
      columns={columns}
      rows={rows}
      emptyMessage="No benchmark rows found."
      groupByKey={groupByKey}
      initialSortKey="ftdBenchmarkRate"
      tableId="benchmark-focus"
      onSelectRow={onSelectRow}
      selectedRowKey={selectedRowKey}
    />
  );
}

function benchmarkMetricsFromReport(report = null) {
  const summary = report?.summary || {};
  const tableRows = Array.isArray(report?.table) ? report.table : [];
  const firstDataRow = tableRows.find((row) => row?.__rowKind !== "total") || tableRows[0] || {};
  const deskAvgRaw = summary.avgFtdByDeskLongTerm ?? firstDataRow.avgFtdByDeskLongTerm;
  const benchmarkRateRaw = summary.ftdBenchmarkRate ?? firstDataRow.ftdBenchmarkRate;
  const leadsRaw = summary.totalLeads ?? summary.leads ?? firstDataRow.leads;
  const ftdRaw = summary.totalFtd ?? summary.ftd ?? firstDataRow.ftd;
  return {
    deskAvgFtdLongTerm: Number(deskAvgRaw || 0),
    benchmarkRate: Number(benchmarkRateRaw || 0),
    leads: Number(leadsRaw || 0),
    ftd: Number(ftdRaw || 0),
  };
}

export default function DashboardDetailsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contextFilters, setContextFilters] = useState(null);
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: "",
    breakdownReport: null,
    trendReport: null,
    leadsReport: null,
    benchmarkReport: null,
    benchmarkRowsReport: null,
    last4Rows: [],
    last4Loading: false,
  });
  const [linkedFilters, setLinkedFilters] = useState({});
  const [selectedLinkedRowKey, setSelectedLinkedRowKey] = useState("");

  const searchKey = searchParams.toString();

  const detailTarget = useMemo(() => {
    const entityKey = String(searchParams.get("detailsEntity") || "").trim();
    const entityValue = normalizedDetailsValue(searchParams.get("detailsValue") || "");
    const detailsLabel = String(searchParams.get("detailsLabel") || entityValue || "").trim();
    return {
      entityKey,
      entityValue,
      detailsLabel,
      valid: ["desk", "teamLeader", "agent"].includes(entityKey) && Boolean(entityValue),
    };
  }, [searchParams, searchKey]);

  useEffect(() => {
    const contextKey = String(searchParams.get("contextKey") || "").trim();
    let resolved = null;
    if (contextKey) {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          const raw = window.sessionStorage.getItem(contextKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.filters && typeof parsed.filters === "object") {
              resolved = parsed.filters;
            }
          }
          window.sessionStorage.removeItem(contextKey);
        }
      } catch {}
    }
    if (!resolved) {
      resolved = parseFiltersFromSearchParams(searchParams);
    }
    setContextFilters(resolved);
  }, [searchParams, searchKey]);

  useEffect(() => {
    setLinkedFilters({});
    setSelectedLinkedRowKey("");
  }, [detailTarget.entityKey, detailTarget.entityValue]);

  const linkedFilterEntries = useMemo(() => Object.entries(linkedFilters || {}), [linkedFilters]);
  const hasLinkedFilters = linkedFilterEntries.length > 0;
  const handleLinkedRowSelection = useCallback((rowKey, row = {}) => {
    const nextFilters = linkedFiltersFromRow(row);
    setLinkedFilters(nextFilters);
    setSelectedLinkedRowKey(String(rowKey || ""));
  }, []);
  const handleClearLinkedFilters = useCallback(() => {
    setLinkedFilters({});
    setSelectedLinkedRowKey("");
  }, []);

  const entityScopedBaseFilters = useMemo(() => {
    if (!contextFilters) {
      return null;
    }
    const next = {
      ...contextFilters,
      ...linkedFilters,
      reportMode: "specific",
      specificType: "builder",
      columnDimension: "",
      includeColumnGrandTotal: false,
      agentProductivityPlanMode: false,
      last4QuickMode: false,
      benchmarkMode: false,
      includeWorkTime: false,
      hideNotWorking: false,
      totalDimensions: [],
    };
    if (detailTarget.entityKey === "desk") {
      next.desk = [detailTarget.entityValue];
      next.teamLeader = [];
      next.agent = [];
    } else if (detailTarget.entityKey === "teamLeader") {
      next.teamLeader = [detailTarget.entityValue];
      next.agent = [];
    } else {
      next.agent = [detailTarget.entityValue];
    }
    return next;
  }, [contextFilters, detailTarget.entityKey, detailTarget.entityValue, linkedFilters]);

  const trendFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "220",
      metricFields: ["leads", "ftd", "kycFtd", "cr", "crTargetReach", "ftdTargetReach"],
      rowDimensions: detailTarget.entityKey === "agent" ? ["date", "hour"] : ["date"],
    };
  }, [detailTarget.entityKey, entityScopedBaseFilters]);

  const leadsTableFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "220",
      rowDimensions: ["brand", "id", "created", "department", "status", "country", "campaign", "subCampaign", "placement", "agent"],
      metricFields: ["ftd"],
    };
  }, [entityScopedBaseFilters]);

  const breakdownFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "280",
      // Match dashboard "Traffic Reports" quick preset shape.
      rowDimensions: ["desk", "country", "campaign", "subCampaign", "placement"],
      metricFields: ["leads", "leadShare", "agentCount", "avgLeadByAgentDaily", "avgLeadByAgent", "ftd", "crTarget", "crTargetReach", "missingFtd"],
    };
  }, [entityScopedBaseFilters]);

  const benchmarkFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "40",
      benchmarkMode: true,
      rowDimensions: [detailTarget.entityKey],
      metricFields: ["avgFtdByDeskLongTerm", "ftdBenchmarkRate", "leads", "ftd"],
    };
  }, [detailTarget.entityKey, entityScopedBaseFilters]);
  const benchmarkRowsFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    const rowDimensions = ["desk", "teamLeader", "agent"];
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "260",
      benchmarkMode: true,
      includeWorkTime: true,
      hideNotWorking: false,
      rowDimensions,
      metricFields: [
        "ftd",
        "agentAvgFtdPerWorkedMonth",
        "avgFtdByDeskLongTerm",
        "ftdBenchmarkRate",
        "crTargetReach",
        "ftdTargetReach",
      ],
    };
  }, [detailTarget.entityKey, entityScopedBaseFilters]);

  const breakdownQuery = useMemo(() => (breakdownFilters ? buildReportQuery(breakdownFilters).toString() : ""), [breakdownFilters]);
  const trendQuery = useMemo(() => (trendFilters ? buildReportQuery(trendFilters).toString() : ""), [trendFilters]);
  const leadsQuery = useMemo(() => (leadsTableFilters ? buildReportQuery(leadsTableFilters).toString() : ""), [leadsTableFilters]);
  const benchmarkQuery = useMemo(
    () => (benchmarkFilters ? buildReportQuery(benchmarkFilters).toString() : ""),
    [benchmarkFilters],
  );
  const benchmarkRowsQuery = useMemo(
    () => (benchmarkRowsFilters ? buildReportQuery(benchmarkRowsFilters).toString() : ""),
    [benchmarkRowsFilters],
  );

  useEffect(() => {
    let cancelled = false;
    if (!contextFilters || !breakdownQuery || !trendQuery || !leadsQuery || !benchmarkQuery || !benchmarkRowsQuery) {
      return undefined;
    }
    if (!detailTarget.valid) {
      setState({
        loading: false,
        refreshing: false,
        error: "Missing details target. Go back and right-click a Desk, Team Leader, or Agent row.",
        breakdownReport: null,
        trendReport: null,
        leadsReport: null,
        benchmarkReport: null,
        benchmarkRowsReport: null,
        last4Rows: [],
        last4Loading: false,
      });
      return undefined;
    }
    const load = async () => {
      setState((prev) => {
        const hasExistingData = Boolean(
          prev.breakdownReport || prev.trendReport || prev.leadsReport || prev.benchmarkRowsReport || prev.last4Rows.length,
        );
        return {
          ...prev,
          loading: !hasExistingData,
          refreshing: hasExistingData,
          error: "",
          ...(hasExistingData ? {} : { last4Rows: [], last4Loading: false }),
        };
      });
      try {
        const [breakdownResponse, trendResponse, leadsResponse, benchmarkResponse] = await Promise.all([
          fetch(`/api/dashboard/report?${breakdownQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${trendQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${leadsQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${benchmarkQuery}`, { cache: "no-store" }),
        ]);
        const benchmarkRowsPromise = fetch(`/api/dashboard/report?${benchmarkRowsQuery}`, { cache: "no-store" });
        const [breakdownPayload, trendPayload, leadsPayload, benchmarkPayload] = await Promise.all([
          readApiPayload(breakdownResponse),
          readApiPayload(trendResponse),
          readApiPayload(leadsResponse),
          readApiPayload(benchmarkResponse),
        ]);
        const benchmarkRowsResponse = await benchmarkRowsPromise;
        const benchmarkRowsPayload = await readApiPayload(benchmarkRowsResponse);
        if (!breakdownResponse.ok || breakdownPayload?.ok === false) {
          throw new Error(breakdownPayload?.message || breakdownPayload?.error || "Could not load traffic report.");
        }
        if (!trendResponse.ok || trendPayload?.ok === false) {
          throw new Error(trendPayload?.message || trendPayload?.error || "Could not load trend report.");
        }
        if (!leadsResponse.ok || leadsPayload?.ok === false) {
          throw new Error(leadsPayload?.message || leadsPayload?.error || "Could not load leads details table.");
        }
        if (!benchmarkResponse.ok || benchmarkPayload?.ok === false) {
          throw new Error(benchmarkPayload?.message || benchmarkPayload?.error || "Could not load benchmark details.");
        }
        if (!benchmarkRowsResponse.ok || benchmarkRowsPayload?.ok === false) {
          throw new Error(benchmarkRowsPayload?.message || benchmarkRowsPayload?.error || "Could not load benchmark rows table.");
        }
        const breakdownReport = breakdownPayload.report || null;
        const trendReport = trendPayload.report || null;
        const leadsReport = leadsPayload.report || null;
        const benchmarkReport = benchmarkPayload.report || null;
        const benchmarkRowsReport = benchmarkRowsPayload.report || null;
        const monthOptions = Array.isArray(breakdownReport?.options?.months) ? breakdownReport.options.months : [];
        const monthKeysFromOptions = monthOptions.map((month) => String(month?.key || "").trim()).filter(Boolean);
        const monthKeysFromFilters = Array.isArray(contextFilters?.monthKey) ? contextFilters.monthKey.filter(Boolean) : [];
        const last4MonthKeys = [...new Set(monthKeysFromOptions.length ? monthKeysFromOptions : monthKeysFromFilters)].slice(0, 4);
        const monthLabelByKey = new Map(
          monthOptions
            .map((month) => [String(month?.key || "").trim(), String(month?.month_label || month?.label || month?.key || "").trim()])
            .filter(([key]) => Boolean(key)),
        );
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            error: "",
            breakdownReport,
            trendReport,
            leadsReport,
            benchmarkReport,
            benchmarkRowsReport,
            last4Rows: last4MonthKeys.length ? prev.last4Rows : [],
            last4Loading: last4MonthKeys.length > 0,
          }));
        }
        if (!last4MonthKeys.length) {
          return;
        }
        const monthSummaryRequests = await Promise.all(
          last4MonthKeys.map(async (monthKey) => {
            const monthQuery = buildReportQuery({
              ...entityScopedBaseFilters,
              monthKey: [monthKey],
              rowDimensions: [detailTarget.entityKey],
              metricFields: ["leads", "ftd", "ftdTarget", "cr", "crTarget", "crTargetReach", "ftdTargetReach"],
              includeWorkTime: false,
              benchmarkMode: false,
              page: "1",
              rowLimit: "40",
            }).toString();
            const response = await fetch(`/api/dashboard/report?${monthQuery}`, { cache: "no-store" });
            const payload = await readApiPayload(response);
            if (!response.ok || payload?.ok === false) {
              throw new Error(payload?.message || payload?.error || `Could not load ${monthKey} monthly summary.`);
            }
            return {
              monthKey,
              monthLabel: monthLabelByKey.get(monthKey) || monthKey,
              summary: payload?.report?.summary || {},
            };
          }),
        );
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            refreshing: false,
            last4Rows: monthSummaryRequests,
            last4Loading: false,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => {
            const hasExistingData = Boolean(
              prev.breakdownReport || prev.trendReport || prev.leadsReport || prev.benchmarkRowsReport || prev.last4Rows.length,
            );
            if (hasExistingData) {
              return {
                ...prev,
                loading: false,
                refreshing: false,
                last4Loading: false,
                error: error?.message || "Could not load details report.",
              };
            }
            return {
              loading: false,
              refreshing: false,
              error: error?.message || "Could not load details report.",
              breakdownReport: null,
              trendReport: null,
              leadsReport: null,
              benchmarkReport: null,
              benchmarkRowsReport: null,
              last4Rows: [],
              last4Loading: false,
            };
          });
        }
      }
    };
    const timerId = window.setTimeout(load, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    benchmarkQuery,
    benchmarkRowsQuery,
    breakdownQuery,
    contextFilters,
    detailTarget.entityKey,
    detailTarget.valid,
    entityScopedBaseFilters,
    leadsQuery,
    trendQuery,
  ]);

  const displayBreakdownReport = useMemo(
    () => applyLinkedFiltersToReport(state.breakdownReport, linkedFilters),
    [linkedFilters, state.breakdownReport],
  );
  const displayTrendReport = useMemo(
    () => applyLinkedFiltersToReport(state.trendReport, linkedFilters),
    [linkedFilters, state.trendReport],
  );
  const displayLeadsReport = useMemo(
    () => applyLinkedFiltersToReport(state.leadsReport, linkedFilters),
    [linkedFilters, state.leadsReport],
  );
  const displayBenchmarkRowsReport = useMemo(
    () => applyLinkedFiltersToReport(state.benchmarkRowsReport, linkedFilters),
    [linkedFilters, state.benchmarkRowsReport],
  );

  const summary = displayBreakdownReport?.summary || state.breakdownReport?.summary || {};
  const trendSummary = displayTrendReport?.summary || state.trendReport?.summary || {};
  const hasKycMetric =
    Object.prototype.hasOwnProperty.call(trendSummary, "kycFtd") ||
    Object.prototype.hasOwnProperty.call(summary, "kycFtd");
  const kycSummaryValue = Number(
    trendSummary.kycFtd ?? summary.kycFtd ?? displayBenchmarkRowsReport?.summary?.kycFtd ?? state.benchmarkRowsReport?.summary?.kycFtd ?? 0,
  );
  const summaryItems = [
    { label: "Leads", value: formatNumber(summary.totalLeads || summary.leads || 0) },
    { label: "FTD", value: formatNumber(summary.totalFtd || summary.ftd || 0) },
    ...(hasKycMetric ? [{ label: "KYC FTD", value: formatNumber(kycSummaryValue) }] : []),
    { label: "CR", value: formatPercent(summary.cr || 0) },
    { label: "CR Target Reach", value: formatPercent(summary.crTargetReach || 0) },
    { label: "FTD Target Reach", value: formatPercent(summary.ftdTargetReach || 0) },
  ];
  const benchmarkMetrics = benchmarkMetricsFromReport(hasLinkedFilters ? displayBenchmarkRowsReport : state.benchmarkReport);
  const representativeRow = useMemo(() => {
    const reports = [displayBenchmarkRowsReport, displayBreakdownReport, displayLeadsReport];
    for (const report of reports) {
      const rows = Array.isArray(report?.table) ? report.table : [];
      const row = rows.find((item) => item?.__rowKind !== "total");
      if (row) {
        return row;
      }
    }
    return null;
  }, [displayBenchmarkRowsReport, displayBreakdownReport, displayLeadsReport]);
  const officeLabel =
    (Array.isArray(contextFilters?.officeScope) && contextFilters.officeScope.length ? contextFilters.officeScope[0] : "") ||
    "-";
  const deskLabel =
    detailTarget.entityKey === "desk"
      ? detailTarget.entityValue
      : (Array.isArray(contextFilters?.desk) && contextFilters.desk.length ? contextFilters.desk[0] : "") ||
        String(representativeRow?.desk || "").trim() ||
        "-";
  const teamLeaderLabel =
    detailTarget.entityKey === "teamLeader"
      ? detailTarget.entityValue
      : (Array.isArray(contextFilters?.teamLeader) && contextFilters.teamLeader.length ? contextFilters.teamLeader[0] : "") ||
        String(representativeRow?.teamLeader || "").trim() ||
        "-";
  const agentLabel =
    detailTarget.entityKey === "agent"
      ? detailTarget.entityValue
      : (Array.isArray(contextFilters?.agent) && contextFilters.agent.length ? contextFilters.agent[0] : "") ||
        String(representativeRow?.agent || "").trim() ||
        "-";
  const hasAnyData = Boolean(
    state.breakdownReport || state.trendReport || state.leadsReport || state.benchmarkRowsReport || state.last4Rows.length,
  );

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <button type="button" className={styles.backButton} onClick={() => router.push("/dashboard")}>
            ← Back to Dashboard
          </button>
        </div>
        <h1 className={styles.title}>Detailed Report</h1>
        <p className={styles.subtitle}>
          {ENTITY_LABELS[detailTarget.entityKey] || "Entity"}: <strong>{detailTarget.detailsLabel || detailTarget.entityValue || "-"}</strong>
        </p>
        <p className={styles.subtitle}>
          Office:{" "}
          <strong>{Array.isArray(contextFilters?.officeScope) && contextFilters.officeScope.length ? contextFilters.officeScope[0] : "-"}</strong>{" "}
          | Months:{" "}
          <strong>
            {Array.isArray(contextFilters?.monthKey) && contextFilters.monthKey.length ? contextFilters.monthKey.join(", ") : "-"}
          </strong>
        </p>
        <div className={styles.contextGrid}>
          <div className={styles.contextChip}>
            <span className={styles.contextLabel}>Office</span>
            <strong>{officeLabel}</strong>
          </div>
          <div className={styles.contextChip}>
            <span className={styles.contextLabel}>Desk</span>
            <strong>{deskLabel}</strong>
          </div>
          <div className={styles.contextChip}>
            <span className={styles.contextLabel}>Team Leader</span>
            <strong>{teamLeaderLabel}</strong>
          </div>
          <div className={styles.contextChip}>
            <span className={styles.contextLabel}>Agent</span>
            <strong>{agentLabel}</strong>
          </div>
        </div>
        <div className={styles.linkedFilterBar}>
          <span className={styles.contextLabel}>Linked Filter</span>
          {hasLinkedFilters ? (
            <span className={styles.linkedFilterValue}>
              {linkedFilterEntries.map(([key, values]) => `${key}: ${Array.isArray(values) ? values.join(", ") : values}`).join(" | ")}
            </span>
          ) : (
            <span className={styles.inlineHint}>None (click a row in any table to filter all tables)</span>
          )}
          {hasLinkedFilters ? (
            <button type="button" className={styles.actionButton} onClick={handleClearLinkedFilters}>
              Clear Linked Filter
            </button>
          ) : null}
        </div>
      </section>

      {state.loading && !hasAnyData ? (
        <section className={styles.panel}>
          <p className={styles.loading}>Loading detailed report...</p>
        </section>
      ) : null}
      {state.refreshing ? (
        <section className={styles.panel}>
          <p className={styles.loading}>Updating tables according to selection...</p>
        </section>
      ) : null}
      {state.error ? (
        <section className={styles.panel}>
          <p className={styles.error}>{state.error}</p>
        </section>
      ) : null}
      {hasAnyData ? (
        <>
          <section className={`${styles.panel} ${styles.summaryGrid}`}>
            {summaryItems.map((item) => (
              <div key={item.label} className={styles.summaryCard}>
                <div className={styles.summaryLabel}>{item.label}</div>
                <div className={styles.summaryValue}>{item.value}</div>
              </div>
            ))}
          </section>
          {state.last4Loading ? (
            <section className={styles.panel}>
              <p className={styles.loading}>Loading last 4 months...</p>
            </section>
          ) : null}
          {!state.last4Loading ? (
            <Last4MonthsMatrixTable
              title="Last 4 Months Results"
              monthRows={state.last4Rows}
              deskLabel={deskLabel}
              teamLeaderLabel={teamLeaderLabel}
              agentLabel={agentLabel}
              tableId="last4-summary"
              onSelectRow={handleLinkedRowSelection}
              selectedRowKey={selectedLinkedRowKey}
            />
          ) : null}
          <section className={`${styles.panel} ${styles.summaryGrid}`}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Desk Avg FTD per Desk By Long Term</div>
              <div className={styles.summaryValue}>{formatDecimal(benchmarkMetrics.deskAvgFtdLongTerm, 2)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark Rate</div>
              <div className={styles.summaryValue}>{formatPercent(benchmarkMetrics.benchmarkRate)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark Leads</div>
              <div className={styles.summaryValue}>{formatNumber(benchmarkMetrics.leads)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark FTD</div>
              <div className={styles.summaryValue}>{formatNumber(benchmarkMetrics.ftd)}</div>
            </div>
          </section>
          <BenchmarkFocusTable
            title="Benchmark Focus Table"
            report={displayBenchmarkRowsReport}
            groupByKey={detailTarget.entityKey === "desk" ? "teamLeader" : ""}
            onSelectRow={handleLinkedRowSelection}
            selectedRowKey={selectedLinkedRowKey}
          />
          <section className={styles.dualGrid}>
            <InteractiveDetailTable
              title="Daily Trend"
              report={displayTrendReport}
              emptyMessage="No daily trend rows found."
              groupByKey="date"
              hierarchyKeys={["date", "hour"]}
              initialSortKey="date"
              tableId="daily-trend"
              onSelectRow={handleLinkedRowSelection}
              selectedRowKey={selectedLinkedRowKey}
            />
            <InteractiveDetailTable
              title="Leads Sheet Fields"
              report={displayLeadsReport}
              emptyMessage="No leads rows found for selected filters."
              groupByKey="brand"
              initialSortKey="brand"
              tableId="leads-fields"
              onSelectRow={handleLinkedRowSelection}
              selectedRowKey={selectedLinkedRowKey}
              enableRowGroupCollapse={false}
            />
          </section>
          <HierarchicalTrafficTable
            title="Traffic Report"
            report={displayBreakdownReport}
            tableId="detailed-breakdown"
            groupKeys={["country", "campaign", "subCampaign", "placement"]}
            onSelectRow={handleLinkedRowSelection}
            selectedRowKey={selectedLinkedRowKey}
          />
        </>
      ) : null}
    </main>
  );
}
