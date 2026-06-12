import ExcelJS from "exceljs";

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
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric <= 2 ? numeric * 100 : numeric;
}

function applyReachCellStyle(cell, percentValue) {
  let fgColor = "FFFFE4E6";
  let fontColor = "FFB91C1C";
  if (percentValue >= 100) {
    fgColor = "FFDCFCE7";
    fontColor = "FF166534";
  } else if (percentValue >= 80) {
    fgColor = "FFFEF3C7";
    fontColor = "FF92400E";
  }
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fgColor },
  };
  cell.font = { ...(cell.font || {}), bold: true, color: { argb: fontColor } };
}

function applyBenchmarkCellStyle(cell, percentValue) {
  let fgColor = "FFEF4444";
  if (percentValue >= 110) {
    fgColor = "FF16A34A";
  } else if (percentValue >= 85) {
    fgColor = "FF65A30D";
  } else if (percentValue >= 60) {
    fgColor = "FFFACC15";
  }
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fgColor },
  };
  cell.font = {
    ...(cell.font || {}),
    bold: true,
    color: { argb: percentValue >= 60 && percentValue < 85 ? "FF713F12" : "FFFFFFFF" },
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

function applyMetricColoring(worksheet, columns = [], startRow = 2) {
  columns.forEach((column, index) => {
    const columnIndex = index + 1;
    const key = String(column.key || "").toLowerCase();
    const header = String(column.header || "").toLowerCase();
    const isReachColumn = key.includes("reach") || header.includes("reach");
    const isBenchmarkColumn = key.includes("ftdbenchmarkrate") || header.includes("benchmark rate");
    const isStatusColumn = key.includes("currentstatus") || header.includes("current status");
    if (!isReachColumn && !isBenchmarkColumn && !isStatusColumn) {
      return;
    }
    for (let rowIndex = startRow; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const cell = worksheet.getRow(rowIndex).getCell(columnIndex);
      if (isStatusColumn) {
        applyStatusCellStyle(cell, cell.value);
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

function addBuilderTableSheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const builderColumns = report?.builder?.columns || [];
  const builder = report?.builder || {};
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
      width: Math.max(12, String(column.label || column.key || "").length + 4),
      type: column.type || "text",
    }));
    setColumnWidths(worksheet, columns);
    styleHeader(worksheet.getRow(1));
    for (const row of report.table || []) {
      const payload = {};
      for (const column of columns) {
        const value = row[column.key];
        payload[column.key] = column.type === "percent" ? percentCell(value) : value;
      }
      worksheet.addRow(payload);
    }
    columns.forEach((column, index) => {
      if (column.type === "percent") {
        percentFormat(worksheet, index + 1);
      }
    });
    applyTableGrid(worksheet, columns.length, 1);
    applyMetricColoring(worksheet, columns, 2);
    return;
  }

  const dimensionColumns = builderColumns.filter((column) => column.kind === "dimension");
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
  const columns = [...dimensionColumns, ...pivotMetricColumns, ...pivotTailColumns].map((column) => ({
    key: column.key,
    header: column.label || titleCase(column.key),
    width: Math.max(12, String(column.label || column.key || "").length + 4),
    type: column.type || "text",
  }));
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  let columnIndex = 1;
  for (const column of dimensionColumns) {
    worksheet.mergeCells(1, columnIndex, 2, columnIndex);
    worksheet.getCell(1, columnIndex).value = column.label || titleCase(column.key);
    columnIndex += 1;
  }
  for (const columnValue of columnValues) {
    const groupStart = columnIndex;
    for (const metric of columnMetrics) {
      const metricColumn = builderColumnByKey.get(`${builder.columnDimension}_${columnValue}__${metric.key}`);
      worksheet.getCell(2, columnIndex).value = metric?.label || metricColumn?.label || titleCase(metric?.key || "");
      columnIndex += 1;
    }
    if (columnIndex > groupStart) {
      worksheet.mergeCells(1, groupStart, 1, columnIndex - 1);
      worksheet.getCell(1, groupStart).value = formatBuilderColumnGroupLabel(columnValue);
    }
  }
  for (const column of pivotTailColumns) {
    worksheet.mergeCells(1, columnIndex, 2, columnIndex);
    worksheet.getCell(1, columnIndex).value = column.label || titleCase(column.key);
    columnIndex += 1;
  }
  styleHeader(worksheet.getRow(1));
  styleHeader(worksheet.getRow(2));

  for (const row of report.table || []) {
    const payload = {};
    for (const column of columns) {
      const value = row[column.key];
      payload[column.key] = column.type === "percent" ? percentCell(value) : value;
    }
    worksheet.addRow(payload);
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  const metricsPerGroup = columnMetrics.length;
  const groupStartColumn = dimensionColumns.length + 1;
  for (let groupIndex = 0; groupIndex < columnValues.length; groupIndex += 1) {
    const start = groupStartColumn + groupIndex * metricsPerGroup;
    const end = start + metricsPerGroup - 1;
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const leftCell = worksheet.getRow(rowIndex).getCell(start);
      const rightCell = worksheet.getRow(rowIndex).getCell(end);
      leftCell.border = {
        ...(leftCell.border || {}),
        left: { style: "medium", color: { argb: "FF94A3B8" } },
      };
      rightCell.border = {
        ...(rightCell.border || {}),
        right: { style: "medium", color: { argb: "FF94A3B8" } },
      };
    }
  }
  applyTableGrid(worksheet, columns.length, 1);
  applyMetricColoring(worksheet, columns, 3);
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
  for (const month of monthBlocks) {
    const groupStart = headerColumnIndex;
    for (const metric of monthMetricColumns) {
      worksheet.getCell(2, headerColumnIndex).value = metric.header;
      headerColumnIndex += 1;
    }
    if (headerColumnIndex > groupStart) {
      worksheet.mergeCells(1, groupStart, 1, headerColumnIndex - 1);
      worksheet.getCell(1, groupStart).value = month.key || month.label || "";
      monthGroupRanges.push({
        start: groupStart,
        end: headerColumnIndex - 1,
        ftdTargetReachColumn: groupStart + 2,
        crTargetReachColumn: groupStart + 5,
      });
    }
  }
  styleHeader(worksheet.getRow(1));
  styleHeader(worksheet.getRow(2));

  // Match bot-like matrix header colors for last4 export.
  const applyMatrixHeaderCell = (cell, background = "FFD9D9D9") => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: background },
    };
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  };
  for (let columnIndex = 1; columnIndex <= columns.length; columnIndex += 1) {
    applyMatrixHeaderCell(worksheet.getCell(1, columnIndex), "FFD9D9D9");
    applyMatrixHeaderCell(worksheet.getCell(2, columnIndex), "FFE6E6E6");
  }

  for (const range of monthGroupRanges) {
    for (let columnIndex = range.start; columnIndex <= range.end; columnIndex += 1) {
      const monthTitleCell = worksheet.getCell(1, columnIndex);
      applyMatrixHeaderCell(monthTitleCell, "FFD9D9D9");
      const metricTitleCell = worksheet.getCell(2, columnIndex);
      applyMatrixHeaderCell(metricTitleCell, "FFE6E6E6");
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
      const ftdTargetReachCell = worksheet.getCell(meta.rowNumber, range.ftdTargetReachColumn);
      const crTargetReachCell = worksheet.getCell(meta.rowNumber, range.crTargetReachColumn);
      const ftdReachRaw = Number(ftdTargetReachCell.value);
      const crReachRaw = Number(crTargetReachCell.value);
      applyReachCellStyle(ftdTargetReachCell, Number.isFinite(ftdReachRaw) ? (ftdReachRaw <= 2 ? ftdReachRaw * 100 : ftdReachRaw) : 0);
      applyReachCellStyle(crTargetReachCell, Number.isFinite(crReachRaw) ? (crReachRaw <= 2 ? crReachRaw * 100 : crReachRaw) : 0);
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
    addBuilderTableSheet(workbook, report);
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

export async function dashboardReportWorkbookBuffer(report = {}, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Dashboard";
  workbook.created = new Date();
  addSummarySheet(workbook, report, query);
  if (asEnabled(query.agentProductivityPlanMode)) {
    addAgentProductivityPlanSheet(workbook, report);
  } else if (report.tableType === "last4_matrix") {
    addLast4Sheet(workbook, report);
  } else if (report.tableType === "pivot") {
    addPivotTableSheet(workbook, report);
  } else if (report.tableType === "builder") {
    addBuilderTableSheet(workbook, report);
  } else {
    addSimpleTableSheet(workbook, report);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

