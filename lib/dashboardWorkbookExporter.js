import ExcelJS from "exceljs";

import { TRAFFIC_DEFAULT_COUNT, allocationSequence, resolveTrafficRanking } from "./trafficPriority.js";

function titleCase(value = "") {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
}

function setColumnWidths(worksheet, columns = []) {
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    header: column.header,
    width: Math.max(12, Math.min(36, Number(column.width || String(column.header || "").length + 4))),
  }));
}

function percentCell(value) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return Number(value) / 100;
}

function percentFormat(worksheet, columnIndex) {
  worksheet.getColumn(columnIndex).numFmt = "0.00%";
}

const MONTH_BLOCK_THEMES = [
  { header: "FF1D4ED8", line: "FF1E3A8A", light: "FFDCE8FF" },
  { header: "FF7C3AED", line: "FF4C1D95", light: "FFEDE5FF" },
  { header: "FFC2410C", line: "FF9A3412", light: "FFFFE7D6" },
  { header: "FF0F766E", line: "FF134E4A", light: "FFD5FAF5" },
  { header: "FFBE123C", line: "FF881337", light: "FFFFE1EA" },
  { header: "FF475569", line: "FF334155", light: "FFE2E8F0" },
];
const COLUMN_GRAND_TOTAL_KEY = "__grand_total__";

function applyTableGrid(worksheet, columnCount, startRow = 1) {
  for (let rowIndex = startRow; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const cell = row.getCell(columnIndex);
      const existing = cell.border || {};
      cell.border = {
        top: existing.top || { style: "thin", color: { argb: "FFC3C6D1" } },
        left: existing.left || { style: "thin", color: { argb: "FFC3C6D1" } },
        bottom: existing.bottom || { style: "thin", color: { argb: "FFC3C6D1" } },
        right: existing.right || { style: "thin", color: { argb: "FFC3C6D1" } },
      };
      if (!cell.alignment) {
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }
    }
    if (rowIndex >= 2 && rowIndex % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.fill || !cell.fill.fgColor) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFD" },
          };
        }
      });
    }
  }
}

function percentValueForThreshold(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    if (trimmed.endsWith("%")) {
      const parsedPercent = Number.parseFloat(trimmed.replace("%", "").trim());
      return Number.isFinite(parsedPercent) ? parsedPercent : 0;
    }
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  // Percent cells in workbook are often stored as decimal ratios (e.g. 2.4194 for 241.94%).
  // Treat values up to 10 as ratios to avoid mis-coloring very high reaches (>200%).
  return Math.abs(numeric) <= 10 ? numeric * 100 : numeric;
}

function applyReachCellStyle(cell, percentValue) {
  const reached = percentValue >= 100;
  const fgColor = reached ? "FFDCFCE7" : "FFFFE4E6";
  const fontColor = reached ? "FF166534" : "FFB91C1C";
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fgColor },
  };
  cell.font = { ...(cell.font || {}), bold: true, color: { argb: fontColor } };
}

function applyBenchmarkCellStyle(cell, percentValue) {
  let fgColor = "FFEF4444";
  let fontColor = "FFFFFFFF";
  if (percentValue >= 110) {
    fgColor = "FF16A34A";
    fontColor = "FFFFFFFF";
  } else if (percentValue >= 85) {
    fgColor = "FFFACC15";
    fontColor = "FF713F12";
  } else if (percentValue >= 60) {
    fgColor = "FFF59E0B";
    fontColor = "FF7C2D12";
  }
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fgColor },
  };
  cell.font = {
    ...(cell.font || {}),
    bold: true,
    color: { argb: fontColor },
  };
}

function applyStatusCellStyle(cell, value) {
  const normalized = String(value || "").trim().toLowerCase();
  const isActive = normalized === "active" || normalized === "working";
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: isActive ? "FF16A34A" : "FFEF4444" },
  };
  cell.font = { ...(cell.font || {}), bold: true, color: { argb: "FFFFFFFF" } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function formatMissingFtdText(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const absFormatted = Math.abs(safe).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${safe <= 0 ? "+" : "-"} ${absFormatted} FTD`;
}

function applyMissingFtdCellStyle(cell, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return;
  }
  cell.value = formatMissingFtdText(numeric);
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: numeric <= 0 ? "FF14532D" : "FF7F1D1D" },
  };
  cell.font = { ...(cell.font || {}), bold: true, color: { argb: "FFFFFFFF" } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function applyMetricColoring(worksheet, columns = [], startRow = 2) {
  columns.forEach((column, index) => {
    const columnIndex = index + 1;
    const key = String(column.key || "").toLowerCase();
    const header = String(column.header || "").toLowerCase();
    const isReachColumn = key.includes("reach") || header.includes("reach");
    const isBenchmarkColumn = key.includes("ftdbenchmarkrate") || header.includes("benchmark rate");
    const isStatusColumn = key.includes("currentstatus") || header.includes("current status");
    const isMissingFtdColumn = key.includes("missingftd") || header.includes("missing ftd");
    if (!isReachColumn && !isBenchmarkColumn && !isStatusColumn && !isMissingFtdColumn) {
      return;
    }
    for (let rowIndex = startRow; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const cell = worksheet.getRow(rowIndex).getCell(columnIndex);
      if (isStatusColumn) {
        applyStatusCellStyle(cell, cell.value);
        continue;
      }
      if (isMissingFtdColumn) {
        applyMissingFtdCellStyle(cell, cell.value);
        continue;
      }
      if (cell.value === "" || cell.value === null || cell.value === undefined) {
        continue;
      }
      const thresholdValue = percentValueForThreshold(cell.value);
      if (isBenchmarkColumn) {
        applyBenchmarkCellStyle(cell, thresholdValue);
      } else {
        applyReachCellStyle(cell, thresholdValue);
      }
    }
  });
}

function formatBuilderColumnGroupLabel(value = "") {
  return String(value || "") === "__grand_total__" ? "Grand Total" : String(value || "");
}

function normalizedNameForRole(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function workingPositionFromRow(row = {}) {
  const teamLeader = normalizedNameForRole(row?.teamLeader || "");
  const agent = normalizedNameForRole(row?.agent || "");
  if (teamLeader && agent && teamLeader === agent) {
    return "Team Leader";
  }
  return "Agent";
}

function numericWorkDays(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function groupKeyFromTeam(row = {}) {
  return `${normalizedNameForRole(row?.desk || "")}::${normalizedNameForRole(row?.teamLeader || "")}`;
}

function sortRowsForLast4QuickExport(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = groupKeyFromTeam(row);
    if (!grouped.has(key)) {
      grouped.set(key, {
        desk: String(row?.desk || ""),
        teamLeader: String(row?.teamLeader || ""),
        rows: [],
      });
    }
    grouped.get(key).rows.push(row);
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        String(left.desk || "").localeCompare(String(right.desk || "")) ||
        String(left.teamLeader || "").localeCompare(String(right.teamLeader || "")),
    )
    .flatMap((group) => {
      const leaderRows = [];
      const agentRows = [];
      for (const row of group.rows) {
        if (workingPositionFromRow(row) === "Team Leader") {
          leaderRows.push(row);
        } else {
          agentRows.push(row);
        }
      }
      leaderRows.sort((left, right) => String(left.agent || "").localeCompare(String(right.agent || "")));
      agentRows.sort(
        (left, right) =>
          numericWorkDays(right.workDays) - numericWorkDays(left.workDays) ||
          String(left.agent || "").localeCompare(String(right.agent || "")),
      );
      return [...leaderRows, ...agentRows];
    });
}

function monthRankFromKey(monthKey = "") {
  const matched = String(monthKey || "")
    .trim()
    .match(/^(\d{4})-(\d{2})$/);
  if (!matched) {
    return null;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return year * 100 + month;
}

function startMonthRankFromDateValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  const matched = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (matched) {
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      return year * 100 + month;
    }
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.getUTCFullYear() * 100 + (parsed.getUTCMonth() + 1);
}

function styleMonthBlocks(worksheet, monthBlocks = [], baseColumns = 3, metricsPerBlock = 6) {
  monthBlocks.forEach((_, index) => {
    const theme = MONTH_BLOCK_THEMES[index % MONTH_BLOCK_THEMES.length];
    const start = baseColumns + index * metricsPerBlock + 1;
    const end = start + metricsPerBlock - 1;
    for (let columnIndex = start; columnIndex <= end; columnIndex += 1) {
      const headerCell = worksheet.getRow(1).getCell(columnIndex);
      headerCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: theme.header },
      };
      headerCell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const dataCell = worksheet.getRow(rowIndex).getCell(columnIndex);
        dataCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: theme.light },
        };
      }
    }
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const leftCell = worksheet.getRow(rowIndex).getCell(start);
      const rightCell = worksheet.getRow(rowIndex).getCell(end);
      leftCell.border = {
        ...(leftCell.border || {}),
        left: { style: "medium", color: { argb: theme.line } },
      };
      rightCell.border = {
        ...(rightCell.border || {}),
        right: { style: "medium", color: { argb: theme.line } },
      };
    }
  });
}

function addSummarySheet(workbook, report = {}, query = {}) {
  const sheet = workbook.addWorksheet("Summary");
  const monthLabel = report?.month?.label || "";
  const officeLabel = report?.month?.office_name || query.officeScope || "";
  const summary = report?.summary || {};
  sheet.addRow(["Dashboard Report Export"]);
  sheet.addRow(["Report Type", String(report?.reportMode || "").toUpperCase()]);
  sheet.addRow(["Specific Type", String(report?.specificType || "").toUpperCase()]);
  sheet.addRow(["Office", officeLabel]);
  sheet.addRow(["Month", monthLabel]);
  sheet.addRow([]);
  sheet.addRow(["Total Leads", Number(summary.totalLeads || 0)]);
  sheet.addRow(["Total FTD", Number(summary.totalFtd || 0)]);
  sheet.addRow(["FTD Target", Number(summary.ftdTarget || 0)]);
  sheet.addRow(["FTD Target Reach", percentCell(summary.ftdTargetReach)]);
  sheet.addRow(["CR", percentCell(summary.cr)]);
  sheet.addRow(["CR Target", percentCell(summary.crTarget)]);
  sheet.addRow(["CR Target Reach", percentCell(summary.crTargetReach)]);
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 26;
  for (const rowIndex of [10, 11, 12, 13]) {
    sheet.getCell(`B${rowIndex}`).numFmt = "0.00%";
  }
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF001F46" } };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDCE8FF" },
  };
  for (let rowIndex = 2; rowIndex <= 13; rowIndex += 1) {
    const left = sheet.getCell(`A${rowIndex}`);
    const right = sheet.getCell(`B${rowIndex}`);
    left.font = { ...(left.font || {}), bold: true, color: { argb: "FF1A1C20" } };
    [left, right].forEach((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFC3C6D1" } },
        left: { style: "thin", color: { argb: "FFC3C6D1" } },
        bottom: { style: "thin", color: { argb: "FFC3C6D1" } },
        right: { style: "thin", color: { argb: "FFC3C6D1" } },
      };
    });
  }
}

function addSimpleTableSheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const columns = [
    { key: "label", header: "Group", width: 28 },
    { key: "totalLeads", header: "Leads", width: 14 },
    { key: "totalFtd", header: "FTD", width: 14 },
    { key: "ftdTarget", header: "FTD Target", width: 14 },
    { key: "ftdTargetReach", header: "FTD Target Reach", width: 18, type: "percent" },
    { key: "cr", header: "CR", width: 12, type: "percent" },
    { key: "crTarget", header: "CR Target", width: 14, type: "percent" },
    { key: "crTargetReach", header: "CR Target Reach", width: 18, type: "percent" },
    { key: "selfs", header: "Selfs", width: 12 },
    { key: "lateFtd", header: "Late FTD", width: 12 },
  ];
  setColumnWidths(worksheet, columns);
  styleHeader(worksheet.getRow(1));
  for (const row of report.table || []) {
    worksheet.addRow({
      label: row.label || "-",
      totalLeads: Number(row.totalLeads || 0),
      totalFtd: Number(row.totalFtd || 0),
      ftdTarget: Number(row.ftdTarget || 0),
      ftdTargetReach: percentCell(row.ftdTargetReach),
      cr: percentCell(row.cr),
      crTarget: percentCell(row.crTarget),
      crTargetReach: percentCell(row.crTargetReach),
      selfs: Number(row.selfs || 0),
      lateFtd: Number(row.lateFtd || 0),
    });
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  applyTableGrid(worksheet, columns.length, 1);
  applyMetricColoring(worksheet, columns, 2);
}

function addPivotTableSheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const columns = [
    { key: "desk", header: "Desk", width: 20 },
    { key: "teamLeader", header: "Team Leader", width: 24 },
    { key: "agent", header: "Agent", width: 24 },
    { key: "totalLeads", header: "Leads", width: 14 },
    { key: "totalFtd", header: "FTD", width: 14 },
    { key: "selfs", header: "Selfs", width: 12 },
    { key: "lateFtd", header: "Late FTD", width: 12 },
    { key: "cr", header: "CR", width: 12, type: "percent" },
    { key: "crTarget", header: "CR Target", width: 14, type: "percent" },
    { key: "crTargetReach", header: "CR Target Reach", width: 18, type: "percent" },
    { key: "ftdTarget", header: "FTD Target", width: 14 },
    { key: "ftdTargetReach", header: "FTD Target Reach", width: 18, type: "percent" },
  ];
  setColumnWidths(worksheet, columns);
  styleHeader(worksheet.getRow(1));
  for (const row of report.table || []) {
    worksheet.addRow({
      desk: row.desk || "-",
      teamLeader: row.teamLeader || "-",
      agent: row.agent || "-",
      totalLeads: Number(row.totalLeads || 0),
      totalFtd: Number(row.totalFtd || 0),
      selfs: Number(row.selfs || 0),
      lateFtd: Number(row.lateFtd || 0),
      cr: percentCell(row.cr),
      crTarget: percentCell(row.crTarget),
      crTargetReach: percentCell(row.crTargetReach),
      ftdTarget: Number(row.ftdTarget || 0),
      ftdTargetReach: percentCell(row.ftdTargetReach),
    });
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  applyTableGrid(worksheet, columns.length, 1);
  applyMetricColoring(worksheet, columns, 2);
}

function addBuilderTableSheet(workbook, report = {}, query = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const builderColumns = report?.builder?.columns || [];
  const builder = report?.builder || {};
  const last4QuickStyleEnabled =
    asEnabled(query.last4QuickMode) && String(builder?.columnDimension || "").trim().toLowerCase() === "month";
  const showWorkingPositionColumn = last4QuickStyleEnabled;
  const isColumnPivot =
    Boolean(builder?.columnDimension) &&
    Array.isArray(builder?.columnValues) &&
    builder.columnValues.length > 0 &&
    Array.isArray(builder?.columnMetrics) &&
    builder.columnMetrics.length > 0;

  if (!isColumnPivot) {
    const columns = builderColumns.map((column) => ({
      key: column.key,
      header: column.label || titleCase(column.key),
      width:
        last4QuickStyleEnabled && column.kind === "metric"
          ? 15
          : Math.max(12, String(column.label || column.key || "").length + 4),
      type: column.type || "text",
      kind: column.kind || "",
    }));
    const visibleColumns = showWorkingPositionColumn
      ? [{ key: "workingPosition", header: "Working Position", width: 18, type: "text" }, ...columns]
      : columns;
    if (last4QuickStyleEnabled) {
      worksheet.views = [{ state: "frozen", ySplit: 2 }];
    }
    setColumnWidths(worksheet, visibleColumns);
    styleHeader(worksheet.getRow(1));
    for (const row of report.table || []) {
      const payload = {};
      for (const column of visibleColumns) {
        const value = column.key === "workingPosition" ? workingPositionFromRow(row) : row[column.key];
        payload[column.key] = column.type === "percent" ? percentCell(value) : value;
      }
      worksheet.addRow(payload);
    }
    const grandTotalRow = report?.builder?.grandTotalRow;
    let grandTotalRowNumber = 0;
    if (grandTotalRow) {
      const payload = {};
      for (const column of visibleColumns) {
        const value = column.key === "workingPosition" ? "" : grandTotalRow[column.key];
        payload[column.key] = column.type === "percent" ? percentCell(value) : value;
      }
      grandTotalRowNumber = worksheet.addRow(payload).number;
    }
    visibleColumns.forEach((column, index) => {
      if (column.type === "percent") {
        percentFormat(worksheet, index + 1);
      }
    });
    applyTableGrid(worksheet, visibleColumns.length, 1);
    applyMetricColoring(worksheet, visibleColumns, 2);
    if (grandTotalRowNumber) {
      const totalRow = worksheet.getRow(grandTotalRowNumber);
      totalRow.eachCell((cell) => {
        cell.font = { ...(cell.font || {}), bold: true };
      });
    }
    return;
  }

  const dimensionColumns = builderColumns.filter((column) => column.kind === "dimension");
  const visibleDimensionColumns = showWorkingPositionColumn
    ? [{ key: "workingPosition", label: "Working Position", type: "text", kind: "dimension" }, ...dimensionColumns]
    : dimensionColumns;
  const builderColumnByKey = new Map(builderColumns.map((column) => [String(column.key || ""), column]));
  const columnValues = builder.columnValues || [];
  const columnMetrics = builder.columnMetrics || [];
  const pivotMetricColumns = columnValues.flatMap((columnValue) =>
    columnMetrics.map((metric) => {
      const metricKey = `${builder.columnDimension}_${columnValue}__${metric.key}`;
      return (
        builderColumnByKey.get(metricKey) || {
          key: metricKey,
          label: `${columnValue} ${metric?.label || titleCase(metric?.key || "")}`,
          type: metric?.type || "number",
          kind: "metric",
        }
      );
    }),
  );
  const pivotMetricKeySet = new Set(pivotMetricColumns.map((column) => column.key));
  const pivotTailColumns = builderColumns.filter((column) => !pivotMetricKeySet.has(column.key) && column.kind !== "dimension");
  const columns = [...visibleDimensionColumns, ...pivotMetricColumns, ...pivotTailColumns].map((column) => ({
    key: column.key,
    header: column.label || titleCase(column.key),
    width:
      last4QuickStyleEnabled && column.kind === "metric"
        ? 15
        : Math.max(12, String(column.label || column.key || "").length + 4),
    type: column.type || "text",
    kind: column.kind || "",
  }));
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width,
  }));
  if (last4QuickStyleEnabled) {
    worksheet.views = [{ state: "frozen", ySplit: 2 }];
  }

  let columnIndex = 1;
  for (const column of visibleDimensionColumns) {
    worksheet.mergeCells(1, columnIndex, 2, columnIndex);
    worksheet.getCell(1, columnIndex).value = column.label || titleCase(column.key);
    columnIndex += 1;
  }
  const monthGroupRanges = [];
  for (const [groupIndex, columnValue] of columnValues.entries()) {
    const groupStart = columnIndex;
    for (const metric of columnMetrics) {
      const metricColumn = builderColumnByKey.get(`${builder.columnDimension}_${columnValue}__${metric.key}`);
      worksheet.getCell(2, columnIndex).value = metric?.label || metricColumn?.label || titleCase(metric?.key || "");
      columnIndex += 1;
    }
    if (columnIndex > groupStart) {
      worksheet.mergeCells(1, groupStart, 1, columnIndex - 1);
      worksheet.getCell(1, groupStart).value = formatBuilderColumnGroupLabel(columnValue);
      monthGroupRanges.push({
        start: groupStart,
        end: columnIndex - 1,
        theme: MONTH_BLOCK_THEMES[groupIndex % MONTH_BLOCK_THEMES.length],
        monthRank: monthRankFromKey(String(columnValue || "")),
      });
    }
  }
  for (const column of pivotTailColumns) {
    worksheet.mergeCells(1, columnIndex, 2, columnIndex);
    worksheet.getCell(1, columnIndex).value = column.label || titleCase(column.key);
    columnIndex += 1;
  }
  styleHeader(worksheet.getRow(1));
  styleHeader(worksheet.getRow(2));
  for (const range of monthGroupRanges) {
    for (let groupColumnIndex = range.start; groupColumnIndex <= range.end; groupColumnIndex += 1) {
      const groupTitleCell = worksheet.getCell(1, groupColumnIndex);
      groupTitleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: range.theme?.header || "FF1D4ED8" },
      };
      groupTitleCell.font = { ...(groupTitleCell.font || {}), bold: true, color: { argb: "FFFFFFFF" } };
      const metricTitleCell = worksheet.getCell(2, groupColumnIndex);
      metricTitleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: range.theme?.light || "FFDCE8FF" },
      };
      metricTitleCell.font = { ...(metricTitleCell.font || {}), bold: true, color: { argb: "FF0F172A" } };
    }
  }

  const sourceRows = Array.isArray(report.table) ? report.table : [];
  const grandTotalRow = report?.builder?.grandTotalRow;
  const orderedRows = [
    ...(last4QuickStyleEnabled ? sortRowsForLast4QuickExport(sourceRows) : sourceRows),
    ...(grandTotalRow ? [grandTotalRow] : []),
  ];
  const dataRowMeta = [];
  for (const row of orderedRows) {
    const payload = {};
    for (const column of columns) {
      const value = column.key === "workingPosition" ? workingPositionFromRow(row) : row[column.key];
      payload[column.key] = column.type === "percent" ? percentCell(value) : value;
    }
    const addedRow = worksheet.addRow(payload);
    dataRowMeta.push({
      rowNumber: addedRow.number,
      rowKind: String(row?.__rowKind || ""),
      startMonthRank: startMonthRankFromDateValue(row?.workStartDate || ""),
      teamGroupKey: groupKeyFromTeam(row),
    });
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  applyTableGrid(worksheet, columns.length, 1);
  for (const range of monthGroupRanges) {
    for (let rowIndex = 3; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      for (let groupColumnIndex = range.start; groupColumnIndex <= range.end; groupColumnIndex += 1) {
        const dataCell = worksheet.getCell(rowIndex, groupColumnIndex);
        dataCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: range.theme?.light || "FFDCE8FF" },
        };
      }
    }
  }
  for (const meta of dataRowMeta) {
    if (meta.rowKind === "total" || !Number.isFinite(meta.startMonthRank)) {
      continue;
    }
    for (const range of monthGroupRanges) {
      if (!Number.isFinite(range.monthRank) || range.monthRank >= meta.startMonthRank) {
        continue;
      }
      for (let groupColumnIndex = range.start; groupColumnIndex <= range.end; groupColumnIndex += 1) {
        const historicalCell = worksheet.getCell(meta.rowNumber, groupColumnIndex);
        historicalCell.value = "";
        historicalCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF6B7280" },
        };
        historicalCell.font = { ...(historicalCell.font || {}), color: { argb: "FFF1F5F9" } };
      }
    }
  }
  applyMetricColoring(worksheet, columns, 3);
  const grandTotalMeta = dataRowMeta.find((meta) => meta.rowKind === "grandTotal");
  if (grandTotalMeta) {
    worksheet.getRow(grandTotalMeta.rowNumber).eachCell((cell) => {
      cell.font = { ...(cell.font || {}), bold: true };
    });
  }
  if (last4QuickStyleEnabled && dataRowMeta.length) {
    let startIndex = 0;
    while (startIndex < dataRowMeta.length) {
      const teamKey = dataRowMeta[startIndex].teamGroupKey;
      let endIndex = startIndex;
      while (endIndex + 1 < dataRowMeta.length && dataRowMeta[endIndex + 1].teamGroupKey === teamKey) {
        endIndex += 1;
      }
      const startRow = dataRowMeta[startIndex].rowNumber;
      const endRow = dataRowMeta[endIndex].rowNumber;
      for (let columnNumber = 1; columnNumber <= columns.length; columnNumber += 1) {
        const topCell = worksheet.getCell(startRow, columnNumber);
        const bottomCell = worksheet.getCell(endRow, columnNumber);
        topCell.border = {
          ...(topCell.border || {}),
          top: { style: "thin", color: { argb: "FF64748B" } },
        };
        bottomCell.border = {
          ...(bottomCell.border || {}),
          bottom: { style: "thin", color: { argb: "FF64748B" } },
        };
      }
      startIndex = endIndex + 1;
    }
  }
  for (const range of monthGroupRanges) {
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const leftCell = worksheet.getCell(rowIndex, range.start);
      const rightCell = worksheet.getCell(rowIndex, range.end);
      leftCell.border = {
        ...(leftCell.border || {}),
        left: { style: "medium", color: { argb: range.theme?.line || "FF334155" } },
      };
      rightCell.border = {
        ...(rightCell.border || {}),
        right: { style: "medium", color: { argb: range.theme?.line || "FF334155" } },
      };
    }
  }
  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    for (let columnNumber = 1; columnNumber <= columns.length; columnNumber += 1) {
      const cell = worksheet.getCell(rowIndex, columnNumber);
      cell.alignment = { ...(cell.alignment || {}), vertical: "middle", horizontal: "center" };
    }
  }
}

function addLast4Sheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const monthBlocks = report.monthBlocks || [];
  const baseColumns = [
    { key: "workingPosition", header: "Working Position", width: 18 },
    { key: "desk", header: "Desk", width: 20 },
    { key: "teamLeader", header: "Team Leader", width: 22 },
    { key: "agent", header: "Agent", width: 24 },
  ];
  const monthMetricColumns = [
    { suffix: "ftd", header: "FTD", width: 10, type: "number" },
    { suffix: "ftdTarget", header: "FTD Target", width: 12, type: "number" },
    { suffix: "ftdTargetReach", header: "FTD Target Reach", width: 14, type: "percent" },
    { suffix: "cr", header: "CR", width: 10, type: "percent" },
    { suffix: "crTarget", header: "CR Target", width: 12, type: "percent" },
    { suffix: "crTargetReach", header: "CR Target Reach", width: 14, type: "percent" },
  ];
  const monthColumns = monthBlocks.flatMap((month) =>
    monthMetricColumns.map((metric) => ({
      key: `${month.key}_${metric.suffix}`,
      header: `${month.label} ${metric.header}`,
      width: metric.width,
      type: metric.type,
    })),
  );
  const columns = [...baseColumns, ...monthColumns];
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  let headerColumnIndex = 1;
  for (const column of baseColumns) {
    worksheet.mergeCells(1, headerColumnIndex, 2, headerColumnIndex);
    worksheet.getCell(1, headerColumnIndex).value = column.header;
    headerColumnIndex += 1;
  }
  const monthGroupRanges = [];
  for (const [monthIndex, month] of monthBlocks.entries()) {
    const theme = MONTH_BLOCK_THEMES[monthIndex % MONTH_BLOCK_THEMES.length];
    const groupStart = headerColumnIndex;
    for (const metric of monthMetricColumns) {
      worksheet.getCell(2, headerColumnIndex).value = metric.header;
      headerColumnIndex += 1;
    }
    if (headerColumnIndex > groupStart) {
      worksheet.mergeCells(1, groupStart, 1, headerColumnIndex - 1);
      worksheet.getCell(1, groupStart).value = monthHeaderLabel(month.key || "", month.label || month.key || "");
      monthGroupRanges.push({
        start: groupStart,
        end: headerColumnIndex - 1,
        ftdTargetReachColumn: groupStart + 2,
        crTargetReachColumn: groupStart + 5,
        monthRank: monthRankFromKey(month.key || ""),
        theme,
      });
    }
  }
  styleHeader(worksheet.getRow(1));
  styleHeader(worksheet.getRow(2));

  const applyMatrixHeaderCell = (cell, background = "FFD9D9D9", color = "FF000000") => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: background },
    };
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: color } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  };
  for (let columnIndex = 1; columnIndex <= columns.length; columnIndex += 1) {
    applyMatrixHeaderCell(worksheet.getCell(1, columnIndex), "FFD9D9D9");
    applyMatrixHeaderCell(worksheet.getCell(2, columnIndex), "FFE6E6E6");
  }

  for (const range of monthGroupRanges) {
    for (let columnIndex = range.start; columnIndex <= range.end; columnIndex += 1) {
      const monthTitleCell = worksheet.getCell(1, columnIndex);
      applyMatrixHeaderCell(monthTitleCell, range.theme?.header || "FF1E40AF", "FFFFFFFF");
      const metricTitleCell = worksheet.getCell(2, columnIndex);
      applyMatrixHeaderCell(metricTitleCell, range.theme?.light || "FFDCE8FF", "FF0F172A");
    }
  }
  worksheet.getRow(1).height = 22;
  worksheet.getRow(2).height = 22;

  const normalizeName = (value = "") =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const dataRowsMeta = [];
  const separatorRowNumbers = [];
  let previousGroupKey = "";
  for (const row of report.table || []) {
    const currentGroupKey = `${String(row.desk || "").trim()}::${String(row.teamLeader || "").trim()}`;
    if (previousGroupKey && currentGroupKey !== previousGroupKey) {
      const separatorRow = worksheet.addRow({});
      separatorRow.height = 8;
      separatorRowNumbers.push(separatorRow.number);
    }
    const payload = {
      workingPosition:
        normalizeName(row.agent || "") && normalizeName(row.agent || "") === normalizeName(row.teamLeader || "")
          ? "Team Leader"
          : "Agent",
      desk: row.desk || "-",
      teamLeader: row.teamLeader || "-",
      agent: row.agent || "-",
    };
    for (const month of monthBlocks) {
      const metric = row.months?.[month.key] || {};
      payload[`${month.key}_ftd`] = Number(metric.ftd || 0);
      payload[`${month.key}_ftdTarget`] = Number(metric.target || 0);
      payload[`${month.key}_ftdTargetReach`] = percentCell(metric.ftdTargetReach);
      payload[`${month.key}_cr`] = percentCell(metric.cr);
      payload[`${month.key}_crTarget`] = percentCell(metric.crTarget);
      payload[`${month.key}_crTargetReach`] = percentCell(metric.crTargetReach);
    }
    const added = worksheet.addRow(payload);
    dataRowsMeta.push({
      rowNumber: added.number,
      isTeamLeader: payload.workingPosition === "Team Leader",
      startMonthRank: startMonthRankFromDateValue(row.startDate || ""),
    });
    previousGroupKey = currentGroupKey;
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  applyTableGrid(worksheet, columns.length, 1);

  for (const rowNumber of separatorRowNumbers) {
    for (let columnIndex = 1; columnIndex <= columns.length; columnIndex += 1) {
      const cell = worksheet.getCell(rowNumber, columnIndex);
      cell.value = "";
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    }
  }

  for (const meta of dataRowsMeta) {
    if (meta.isTeamLeader) {
      for (let columnIndex = 1; columnIndex <= Math.min(4, columns.length); columnIndex += 1) {
        const cell = worksheet.getCell(meta.rowNumber, columnIndex);
        cell.font = { ...(cell.font || {}), bold: true };
      }
    }
    for (const range of monthGroupRanges) {
      const hideBeforeStart = Number.isFinite(meta.startMonthRank) && Number.isFinite(range.monthRank) && range.monthRank < meta.startMonthRank;
      for (let columnIndex = range.start; columnIndex <= range.end; columnIndex += 1) {
        const cell = worksheet.getCell(meta.rowNumber, columnIndex);
        if (hideBeforeStart) {
          cell.value = "";
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF6B7280" },
          };
          cell.font = {
            ...(cell.font || {}),
            color: { argb: "FFF1F5F9" },
          };
        } else {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: range.theme?.light || "FFEFF6FF" },
          };
        }
      }
      if (hideBeforeStart) {
        continue;
      }
      const ftdTargetReachCell = worksheet.getCell(meta.rowNumber, range.ftdTargetReachColumn);
      const crTargetReachCell = worksheet.getCell(meta.rowNumber, range.crTargetReachColumn);
      const ftdReachRaw = Number(ftdTargetReachCell.value);
      const crReachRaw = Number(crTargetReachCell.value);
      applyReachCellStyle(ftdTargetReachCell, percentValueForThreshold(Number.isFinite(ftdReachRaw) ? ftdReachRaw : 0));
      applyReachCellStyle(crTargetReachCell, percentValueForThreshold(Number.isFinite(crReachRaw) ? crReachRaw : 0));
    }
  }

  for (const range of monthGroupRanges) {
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const leftCell = worksheet.getCell(rowIndex, range.start);
      const rightCell = worksheet.getCell(rowIndex, range.end);
      leftCell.border = {
        ...(leftCell.border || {}),
        left: { style: "medium", color: { argb: "FFBDBDBD" } },
      };
      rightCell.border = {
        ...(rightCell.border || {}),
        right: { style: "medium", color: { argb: "FFBDBDBD" } },
      };
    }
  }
  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= columns.length; columnIndex += 1) {
      const cell = worksheet.getCell(rowIndex, columnIndex);
      cell.alignment = { ...(cell.alignment || {}), vertical: "middle", horizontal: "center" };
    }
  }
}

function asEnabled(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function monthDaysFromKey(monthKey = "") {
  const matched = String(monthKey || "")
    .trim()
    .match(/^(\d{4})-(\d{2})$/);
  if (!matched) {
    return 30;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 30;
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dailyLeadDivisorFromMonthKey(monthKey = "", now = new Date()) {
  const matched = String(monthKey || "")
    .trim()
    .match(/^(\d{4})-(\d{2})$/);
  if (!matched) {
    return 30;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 30;
  }
  const fullMonthDays = monthDaysFromKey(monthKey);
  const isCurrentMonth = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  if (!isCurrentMonth) {
    return fullMonthDays;
  }
  // Current month uses completed days only (up to yesterday).
  const completedDayCount = Math.max(1, now.getUTCDate() - 1);
  return Math.max(1, Math.min(fullMonthDays, completedDayCount));
}

function monthHeaderLabel(monthKey = "", fallbackLabel = "") {
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

function metricNumberFromBuilderRow(row = {}, monthKey = "", metricKey = "") {
  const value = Number(row?.[`month_${monthKey}__${metricKey}`] || 0);
  return Number.isFinite(value) ? value : 0;
}

function headerStyle(cell, options = {}) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: options.background || "FFB8C0CC" },
  };
  cell.font = {
    ...(cell.font || {}),
    bold: true,
    color: { argb: options.color || "FF0F172A" },
  };
  cell.alignment = { vertical: "middle", horizontal: options.align || "center" };
  cell.border = {
    top: { style: "thin", color: { argb: "FF7B8794" } },
    left: { style: "thin", color: { argb: "FF7B8794" } },
    bottom: { style: "thin", color: { argb: "FF7B8794" } },
    right: { style: "thin", color: { argb: "FF7B8794" } },
  };
}

function dataStyle(cell, options = {}) {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: options.background || "FFCCEAF7" },
  };
  cell.font = {
    ...(cell.font || {}),
    color: { argb: options.color || "FF0F172A" },
  };
  cell.alignment = { vertical: "middle", horizontal: options.align || "center" };
  cell.border = {
    top: { style: "thin", color: { argb: "FF7B8794" } },
    left: { style: "thin", color: { argb: "FF7B8794" } },
    bottom: { style: "thin", color: { argb: "FF7B8794" } },
    right: { style: "thin", color: { argb: "FF7B8794" } },
  };
}

function addAgentProductivityPlanSheet(workbook, report = {}) {
  const builder = report?.builder || {};
  const monthValues = Array.isArray(builder.columnValues) ? builder.columnValues : [];
  const monthKeys = monthValues.filter((value) => {
    const normalized = String(value || "").trim();
    return normalized && normalized !== COLUMN_GRAND_TOTAL_KEY;
  });
  if (!monthKeys.length) {
    addBuilderTableSheet(workbook, report, {});
    return;
  }
  const worksheet = workbook.addWorksheet("Report");
  const monthLabelMap = new Map(
    (report?.options?.months || []).map((item) => [String(item?.key || ""), String(item?.month_label || item?.key || "")]),
  );
  const monthLabels = monthKeys.map((key) => monthHeaderLabel(String(key), monthLabelMap.get(String(key)) || String(key)));
  worksheet.columns = [
    { key: "metric", width: 34 },
    ...monthKeys.map((key) => ({
      key: String(key),
      width: Math.max(10, String(monthLabelMap.get(String(key)) || key).length + 2),
    })),
  ];

  const dataRows = (report.table || [])
    .filter((row) => row && String(row.country || "").trim())
    .sort((left, right) => String(left.country || "").localeCompare(String(right.country || ""), undefined, { sensitivity: "base" }));
  let rowIndex = 1;
  const metricRows = [
    {
      label: "Lead per agent according mark. Plan",
      valueForMonth: () => "",
      numberFormat: "",
    },
    {
      label: "Daily leads per agent",
      valueForMonth: (values) => {
        const leads = Number(values.leads || 0);
        return leads > 0 ? leads / values.dailyLeadDivisor : 0;
      },
      numberFormat: "0.00",
    },
    {
      label: "Actual leads per agent",
      valueForMonth: (values) => Number(values.leads || 0),
      numberFormat: "0",
    },
    {
      label: "FTDs total",
      valueForMonth: (values) => Number(values.ftd || 0),
      numberFormat: "0",
    },
    {
      label: "CR%",
      valueForMonth: (values) => Number(values.cr || 0) / 100,
      numberFormat: "0%",
    },
    {
      label: "PSPs working?",
      valueForMonth: () => "",
      numberFormat: "",
    },
  ];

  for (const row of dataRows) {
    worksheet.mergeCells(rowIndex, 1, rowIndex, monthKeys.length + 1);
    const countryCell = worksheet.getCell(rowIndex, 1);
    countryCell.value = String(row.country || "-");
    headerStyle(countryCell, { background: "FFB8C0CC", color: "FF0F172A", align: "center" });
    rowIndex += 1;

    const monthHeader = worksheet.getRow(rowIndex);
    monthHeader.getCell(1).value = "";
    headerStyle(monthHeader.getCell(1), { background: "FFB8C0CC", color: "FF0F172A", align: "left" });
    monthLabels.forEach((label, index) => {
      const cell = monthHeader.getCell(index + 2);
      cell.value = label;
      headerStyle(cell, { background: "FFB8C0CC", color: "FF0F172A", align: "center" });
    });
    rowIndex += 1;

    for (const metricRow of metricRows) {
      const line = worksheet.getRow(rowIndex);
      const metricLabelCell = line.getCell(1);
      metricLabelCell.value = metricRow.label;
      dataStyle(metricLabelCell, { background: "FFB8C0CC", align: "left" });
      metricLabelCell.font = { ...(metricLabelCell.font || {}), bold: true };
      monthKeys.forEach((monthKey, index) => {
        const monthDays = monthDaysFromKey(monthKey);
        const dailyLeadDivisor = dailyLeadDivisorFromMonthKey(monthKey);
        const monthMetrics = {
          monthDays,
          dailyLeadDivisor,
          leads: metricNumberFromBuilderRow(row, monthKey, "leads"),
          ftd: metricNumberFromBuilderRow(row, monthKey, "ftd"),
          cr: metricNumberFromBuilderRow(row, monthKey, "cr"),
          crTarget: metricNumberFromBuilderRow(row, monthKey, "crTarget"),
          crTargetReach: metricNumberFromBuilderRow(row, monthKey, "crTargetReach"),
          ftdTarget: metricNumberFromBuilderRow(row, monthKey, "ftdTarget"),
          pspWorking: metricNumberFromBuilderRow(row, monthKey, "agentCount"),
        };
        const cell = line.getCell(index + 2);
        const value = metricRow.valueForMonth(monthMetrics);
        cell.value = value === "" ? "" : Number(value);
        if (metricRow.numberFormat) {
          cell.numFmt = metricRow.numberFormat;
        }
        dataStyle(cell, { background: "FFCCEAF7", align: "center" });
      });
      rowIndex += 1;
    }
    rowIndex += 1;
  }
}

function addLeadSplitterSheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("LeadSplitter");
  const headers = ["Desk", "Country", "Agent", "Leads", "FTD", "CR", "CR Target", "CR Target Reach"];
  const columnWidths = [12, 20, 22, 8, 8, 9, 11, 16];
  const BLOCK_WIDTH = headers.length; // 8
  const SPACER_WIDTH = 1;
  const NUM_COLUMNS = 3;
  const blockStartColumn = (blockIndex) => blockIndex * (BLOCK_WIDTH + SPACER_WIDTH) + 1; // 1, 10, 19

  // Column widths for the 3 side-by-side blocks (+ narrow spacer columns).
  for (let block = 0; block < NUM_COLUMNS; block += 1) {
    const start = blockStartColumn(block);
    columnWidths.forEach((width, index) => {
      worksheet.getColumn(start + index).width = width;
    });
    if (block < NUM_COLUMNS - 1) {
      worksheet.getColumn(start + BLOCK_WIDTH).width = 3;
    }
  }

  // Split the flat row list into whole desk blocks (each ends with a deskTotal).
  const rows = Array.isArray(report?.leadSplitter?.rows) ? report.leadSplitter.rows : [];
  const deskBlocks = [];
  let current = [];
  for (const row of rows) {
    current.push(row);
    if (row.kind === "deskTotal") {
      deskBlocks.push(current);
      current = [];
    }
  }
  if (current.length) {
    deskBlocks.push(current);
  }
  // Option B: distribute desks sequentially across the 3 columns
  // (desk 1,4,7 -> col 1; desk 2,5,8 -> col 2; desk 3,6,9 -> col 3).
  const columnRows = Array.from({ length: NUM_COLUMNS }, () => []);
  deskBlocks.forEach((block, index) => {
    columnRows[index % NUM_COLUMNS].push(...block);
  });

  const border = {
    top: { style: "thin", color: { argb: "FFC3C6D1" } },
    left: { style: "thin", color: { argb: "FFC3C6D1" } },
    bottom: { style: "thin", color: { argb: "FFC3C6D1" } },
    right: { style: "thin", color: { argb: "FFC3C6D1" } },
  };
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  const greenFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
  const redFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };

  for (let block = 0; block < NUM_COLUMNS; block += 1) {
    const columnData = columnRows[block];
    if (!columnData.length) {
      continue;
    }
    const start = blockStartColumn(block);
    // Header row (dark navy, white bold text).
    headers.forEach((header, index) => {
      const cell = worksheet.getCell(1, start + index);
      cell.value = header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = headerFill;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = border;
    });
    // Data rows.
    columnData.forEach((row, rowOffset) => {
      const rowIndex = rowOffset + 2;
      const isDeskTotal = row.kind === "deskTotal";
      const isTotal = isDeskTotal || row.kind === "countryTotal";
      const values = [
        row.desk || "",
        isDeskTotal ? "" : row.country || "",
        row.kind === "agent" ? row.agent || "" : row.label || "",
        Number(row.leads || 0),
        Number(row.ftd || 0),
        percentCell(row.cr),
        percentCell(row.crTarget),
        percentCell(row.crTargetReach),
      ];
      values.forEach((value, index) => {
        const cell = worksheet.getCell(rowIndex, start + index);
        cell.value = value;
        cell.border = border;
        if (index <= 1) {
          cell.alignment = { vertical: "top" };
        }
        if (index >= 5) {
          cell.numFmt = "0.00%";
        }
        if (isTotal) {
          cell.font = { bold: true };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isDeskTotal ? "FFBDD7EE" : "FFDDEBF7" },
          };
        }
      });
      // CR cell: green when > 0, red when 0.
      const crGood = Number(row.cr) > 0;
      const crCell = worksheet.getCell(rowIndex, start + 5);
      crCell.fill = crGood ? greenFill : redFill;
      crCell.font = { ...(crCell.font || {}), color: { argb: crGood ? "FF006100" : "FF9C0006" }, bold: isTotal };
      // CR Target Reach cell: green when target reached (>= 100%), red otherwise.
      const reachGood = Number(row.crTargetReach) >= 100;
      const reachCell = worksheet.getCell(rowIndex, start + 7);
      reachCell.fill = reachGood ? greenFill : redFill;
      reachCell.font = { ...(reachCell.font || {}), color: { argb: reachGood ? "FF006100" : "FF9C0006" }, bold: isTotal };
    });

    // Merge the Desk and Country cells vertically across each country's
    // contiguous agent rows (labels shown once). Total rows are left unmerged so
    // they repeat the label, matching the reference sheet.
    let runStart = null;
    let runKey = null;
    const flushRun = (endRowIndex) => {
      if (runStart !== null && endRowIndex > runStart) {
        worksheet.mergeCells(runStart, start, endRowIndex, start); // Desk
        worksheet.mergeCells(runStart, start + 1, endRowIndex, start + 1); // Country
      }
      runStart = null;
      runKey = null;
    };
    columnData.forEach((row, rowOffset) => {
      const rowIndex = rowOffset + 2;
      if (row.kind === "agent") {
        const key = `${row.desk}||${row.country}`;
        if (runKey === null) {
          runStart = rowIndex;
          runKey = key;
        } else if (key !== runKey) {
          flushRun(rowIndex - 1);
          runStart = rowIndex;
          runKey = key;
        }
      } else {
        flushRun(rowIndex - 1);
      }
    });
    flushRun(columnData.length + 1);
  }
}

function addTrafficPrioritySheet(workbook, report = {}, query = {}) {
  const data = report?.trafficPriority || { countries: [] };
  const countries = Array.isArray(data.countries) ? data.countries : [];
  const country = String(query.tpCountry || "").trim() || countries[0]?.country || "";
  const campaign = String(query.tpCampaign || "").trim();
  const count =
    Number(query.tpCount) > 0 ? Math.floor(Number(query.tpCount)) : Number(data.defaultCount) || TRAFFIC_DEFAULT_COUNT;
  const minSegmentLeads = Number(data.minSegmentLeads) || 10;
  const windowDays = Number(data.windowDays) || 60;
  const blockWindowDays = Number(data.blockWindowDays) || 7;

  const excludeSet = new Set(
    String(query.tpExclude || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const explicitSelection = ["1", "true", "yes", "on"].includes(String(query.trafficPriority || "").toLowerCase().trim());
  const isFullConversion = (agent) => Number(agent?.leads) > 0 && Number(agent?.ftd) === Number(agent?.leads);
  const isIncluded = (agent) => {
    // When the dashboard drives the export it sends the exact excluded list
    // (already accounts for cold + full-conversion defaults and any manual
    // ticks), so honour it verbatim. Otherwise fall back to the on-screen
    // defaults (cold + full-conversion agents off).
    if (explicitSelection) {
      return !excludeSet.has(agent.agent);
    }
    return !agent?.blocked && !isFullConversion(agent);
  };

  const ranking = resolveTrafficRanking(data, { country, campaign });
  const allocation = allocationSequence(
    (Array.isArray(ranking.agents) ? ranking.agents : [])
      .filter((agent) => isIncluded(agent))
      .map((agent) => ({ ...agent, blocked: false })),
    count,
  );
  const summaryAgents = (Array.isArray(ranking.agents) ? ranking.agents.slice() : [])
    .map((agent) => ({
      ...agent,
      included: isIncluded(agent),
      fullConversion: isFullConversion(agent),
      allocated: allocation.counts[agent.agent] || 0,
      share: allocation.shares[agent.agent] || 0,
    }))
    .sort(
      (left, right) =>
        Number(left.blocked) - Number(right.blocked) ||
        right.allocated - left.allocated ||
        right.cr - left.cr ||
        String(left.agent).localeCompare(String(right.agent)),
    );

  const worksheet = workbook.addWorksheet("Traffic Distribution");
  [24, 18, 9, 9, 8, 9, 20].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  const border = {
    top: { style: "thin", color: { argb: "FFC3C6D1" } },
    left: { style: "thin", color: { argb: "FFC3C6D1" } },
    bottom: { style: "thin", color: { argb: "FFC3C6D1" } },
    right: { style: "thin", color: { argb: "FFC3C6D1" } },
  };
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  const greenFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
  const redFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };

  const basisText =
    ranking.basis === "segment"
      ? `Ranking: ${country} / ${campaign} (segment CR, ${ranking.segmentLeads} leads)`
      : ranking.basis === "country-fallback"
        ? `Not enough data for ${campaign} (${ranking.segmentLeads} < ${minSegmentLeads}) - ranking by ${country} country-wide CR`
        : ranking.basis === "country"
          ? `Ranking: ${country} country-wide`
          : "No country selected.";

  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = `Traffic Distribution - last ${windowDays} days (blocked = no FTD in last ${blockWindowDays} days)`;
  titleCell.font = { bold: true, size: 12 };
  worksheet.mergeCells(1, 1, 1, 7);
  const basisCell = worksheet.getCell(2, 1);
  basisCell.value = basisText;
  basisCell.font = { italic: true, color: { argb: "FF475569" } };
  worksheet.mergeCells(2, 1, 2, 7);

  let rowIndex = 4;
  const seqHeader = worksheet.getCell(rowIndex, 1);
  seqHeader.value = "Call Sequence";
  seqHeader.font = { bold: true };
  rowIndex += 1;
  ["#", "Agent"].forEach((header, index) => {
    const cell = worksheet.getCell(rowIndex, index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = headerFill;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = border;
  });
  rowIndex += 1;
  allocation.sequence.forEach((agent, index) => {
    const orderCell = worksheet.getCell(rowIndex, 1);
    orderCell.value = index + 1;
    orderCell.border = border;
    orderCell.alignment = { horizontal: "center" };
    const agentCell = worksheet.getCell(rowIndex, 2);
    agentCell.value = agent;
    agentCell.border = border;
    rowIndex += 1;
  });

  rowIndex += 1;
  const summaryTitle = worksheet.getCell(rowIndex, 1);
  summaryTitle.value = "Agent Summary";
  summaryTitle.font = { bold: true };
  rowIndex += 1;
  const summaryHeaders = ["Agent", "Team Leader", "Leads", "CR", "Count", "Share", "Status"];
  summaryHeaders.forEach((header, index) => {
    const cell = worksheet.getCell(rowIndex, index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = headerFill;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = border;
  });
  rowIndex += 1;
  const yellowFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
  summaryAgents.forEach((agent) => {
    const status = agent.blocked
      ? `Blocked (no FTD ${blockWindowDays}d)`
      : !agent.included
        ? agent.fullConversion
          ? "Excluded (FTD=Leads)"
          : "Excluded"
        : "Active";
    const values = [
      agent.agent,
      agent.teamLeader || "-",
      Number(agent.leads || 0),
      percentCell(agent.cr),
      agent.included ? agent.allocated : "-",
      agent.included ? percentCell(agent.share) : "-",
      status,
    ];
    values.forEach((value, index) => {
      const cell = worksheet.getCell(rowIndex, index + 1);
      cell.value = value;
      cell.border = border;
      if (index === 3 || index === 5) {
        cell.numFmt = "0.00%";
      }
      if (agent.blocked) {
        cell.fill = redFill;
        cell.font = { color: { argb: "FF9C0006" } };
      } else if (agent.fullConversion) {
        cell.fill = yellowFill;
      } else if (index === 3) {
        const good = Number(agent.cr) > 0;
        cell.fill = good ? greenFill : redFill;
        cell.font = { color: { argb: good ? "FF006100" : "FF9C0006" } };
      }
    });
    rowIndex += 1;
  });

  return worksheet;
}

export async function dashboardReportWorkbookBuffer(report = {}, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Dashboard";
  workbook.created = new Date();
  if (report.tableType === "trafficpriority" || report.trafficPriority) {
    addTrafficPrioritySheet(workbook, report, query);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
  if (report.tableType === "leadsplitter" || report.leadSplitter) {
    addLeadSplitterSheet(workbook, report);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
  addSummarySheet(workbook, report, query);
  if (asEnabled(query.agentProductivityPlanMode)) {
    addAgentProductivityPlanSheet(workbook, report);
  } else if (report.tableType === "last4_matrix") {
    addLast4Sheet(workbook, report);
  } else if (report.tableType === "pivot") {
    addPivotTableSheet(workbook, report);
  } else if (report.tableType === "builder") {
    addBuilderTableSheet(workbook, report, query);
  } else {
    addSimpleTableSheet(workbook, report);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

