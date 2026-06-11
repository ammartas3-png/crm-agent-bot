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
  worksheet.views = [{ state: "frozen", ySplit: 2 }];

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
    { key: "desk", header: "Desk", width: 18 },
    { key: "teamLeader", header: "Team Leader", width: 22 },
    { key: "agent", header: "Agent", width: 24 },
  ];
  const monthColumns = monthBlocks.flatMap((month) => [
    { key: `${month.key}_target`, header: `${month.label} Target`, width: 16 },
    { key: `${month.key}_ftd`, header: `${month.label} FTD`, width: 14 },
    { key: `${month.key}_cr`, header: `${month.label} CR`, width: 14, type: "percent" },
    { key: `${month.key}_crTarget`, header: `${month.label} CR Target`, width: 16, type: "percent" },
    { key: `${month.key}_crTargetReach`, header: `${month.label} CR Reach`, width: 16, type: "percent" },
    { key: `${month.key}_ftdTargetReach`, header: `${month.label} FTD Reach`, width: 16, type: "percent" },
  ]);
  const tailColumns = [
    { key: "startDate", header: "Starting Date", width: 16 },
    { key: "monthsWorked", header: "Months Worked", width: 16 },
    { key: "currentStatus", header: "Current Status", width: 18 },
  ];
  const columns = [...baseColumns, ...monthColumns, ...tailColumns];
  setColumnWidths(worksheet, columns);
  styleHeader(worksheet.getRow(1));
  for (const row of report.table || []) {
    const payload = {
      desk: row.desk || "-",
      teamLeader: row.teamLeader || "-",
      agent: row.agent || "-",
    };
    for (const month of monthBlocks) {
      const metric = row.months?.[month.key] || {};
      payload[`${month.key}_target`] = Number(metric.target || 0);
      payload[`${month.key}_ftd`] = Number(metric.ftd || 0);
      payload[`${month.key}_cr`] = percentCell(metric.cr);
      payload[`${month.key}_crTarget`] = percentCell(metric.crTarget);
      payload[`${month.key}_crTargetReach`] = percentCell(metric.crTargetReach);
      payload[`${month.key}_ftdTargetReach`] = percentCell(metric.ftdTargetReach);
    }
    payload.startDate = row.startDate || "-";
    payload.monthsWorked = row.monthsWorked || "-";
    payload.currentStatus = row.currentStatus || "Not Working";
    worksheet.addRow(payload);
  }
  columns.forEach((column, index) => {
    if (column.type === "percent") {
      percentFormat(worksheet, index + 1);
    }
  });
  applyTableGrid(worksheet, columns.length, 1);
  styleMonthBlocks(worksheet, monthBlocks, baseColumns.length, 6);
  applyMetricColoring(worksheet, columns, 2);
}

export async function dashboardReportWorkbookBuffer(report = {}, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Dashboard";
  workbook.created = new Date();
  addSummarySheet(workbook, report, query);
  if (report.tableType === "last4_matrix") {
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

