import ExcelJS from "exceljs";

function percentCellValue(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value / 100;
}

function setReachStyle(cell, rawPercentValue) {
  if (!Number.isFinite(rawPercentValue)) {
    cell.value = "-";
    cell.alignment = { vertical: "middle", horizontal: "center" };
    return;
  }
  cell.value = rawPercentValue / 100;
  cell.numFmt = "0.00%";
  cell.alignment = { vertical: "middle", horizontal: "center" };
  const reached = rawPercentValue >= 100;
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: reached ? "FF2E7D32" : "FFC62828" },
  };
  cell.font = {
    color: { argb: "FFFFFFFF" },
    italic: true,
  };
}

function styleHeaderRow(row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFBDBDBD" } },
      left: { style: "thin", color: { argb: "FFBDBDBD" } },
      bottom: { style: "thin", color: { argb: "FFBDBDBD" } },
      right: { style: "thin", color: { argb: "FFBDBDBD" } },
    };
  });
}

function modeColumns(mode = "full") {
  if (mode === "last4") {
    return [
      { header: "Level", key: "level", width: 14 },
      { header: "Office", key: "office", width: 20 },
      { header: "Team Leader", key: "teamLeader", width: 20 },
      { header: "Agent", key: "agent", width: 22 },
      { header: "Month", key: "month", width: 12 },
      { header: "Target", key: "target", width: 12 },
      { header: "FTD", key: "ftd", width: 12 },
      { header: "CR", key: "cr", width: 12 },
      { header: "CR Target Reach", key: "crTargetReach", width: 18 },
      { header: "FTD Target Reach", key: "ftdTargetReach", width: 18 },
    ];
  }
  return [
    { header: "Level", key: "level", width: 14 },
    { header: "Office", key: "office", width: 20 },
    { header: "Team Leader", key: "teamLeader", width: 20 },
    { header: "Agent", key: "agent", width: 22 },
    { header: "Lead", key: "lead", width: 12 },
    { header: "FTD", key: "ftd", width: 12 },
    { header: "CR", key: "cr", width: 12 },
    { header: "Selfs", key: "selfs", width: 12 },
    { header: "Late FTD", key: "lateFtd", width: 12 },
    { header: "CR Target", key: "crTarget", width: 12 },
    { header: "CR Target Reach", key: "crTargetReach", width: 18 },
    { header: "FTD Target", key: "ftdTarget", width: 12 },
    { header: "FTD Target Reach", key: "ftdTargetReach", width: 18 },
  ];
}

function baseRowData(item = {}, mode = "full") {
  const metrics = item.metrics || {};
  if (mode === "last4") {
    return {
      level: item.level || "",
      office: item.office || "",
      teamLeader: item.teamLeader || "",
      agent: item.agent || "",
      month: item.month || "",
      target: Number.isFinite(metrics.ftdTarget) ? metrics.ftdTarget : "-",
      ftd: Number.isFinite(metrics.ftd) ? metrics.ftd : 0,
      cr: percentCellValue(metrics.cr),
      crTargetReach: metrics.crTargetReach,
      ftdTargetReach: metrics.ftdTargetReach,
    };
  }
  return {
    level: item.level || "",
    office: item.office || "",
    teamLeader: item.teamLeader || "",
    agent: item.agent || "",
    lead: Number.isFinite(metrics.lead) ? metrics.lead : 0,
    ftd: Number.isFinite(metrics.ftd) ? metrics.ftd : 0,
    cr: percentCellValue(metrics.cr),
    selfs: Number.isFinite(metrics.selfs) ? metrics.selfs : 0,
    lateFtd: Number.isFinite(metrics.lateFtd) ? metrics.lateFtd : 0,
    crTarget: percentCellValue(metrics.crTarget),
    crTargetReach: metrics.crTargetReach,
    ftdTarget: Number.isFinite(metrics.ftdTarget) ? metrics.ftdTarget : "-",
    ftdTargetReach: metrics.ftdTargetReach,
  };
}

function styleDataRow(worksheet, row, item, mode = "full") {
  const columns = modeColumns(mode);
  const infoColumnKeys = ["level", "office", "teamLeader", "agent", "month"];
  const infoColumnSet = new Set(
    columns
      .filter((column) => infoColumnKeys.includes(column.key))
      .map((column) => columns.findIndex((itemColumn) => itemColumn.key === column.key) + 1),
  );
  const crCol = columns.findIndex((column) => column.key === "cr") + 1;
  const crTargetCol = columns.findIndex((column) => column.key === "crTarget") + 1;
  const crReachCol = columns.findIndex((column) => column.key === "crTargetReach") + 1;
  const ftdReachCol = columns.findIndex((column) => column.key === "ftdTargetReach") + 1;

  if (infoColumnSet.size && item.kind !== "month") {
    for (const colIndex of infoColumnSet) {
      const infoCell = row.getCell(colIndex);
      infoCell.font = {
        ...(infoCell.font || {}),
        bold: item.kind === "group" || item.kind === "summary",
      };
    }
  }

  row.eachCell((cell, colNumber) => {
    if (!infoColumnSet.has(colNumber)) {
      cell.font = { ...(cell.font || {}), italic: true };
    }
    if (!cell.alignment) {
      cell.alignment = { vertical: "middle", horizontal: "center" };
    }
    cell.border = {
      top: { style: "thin", color: { argb: "FFEEEEEE" } },
      left: { style: "thin", color: { argb: "FFEEEEEE" } },
      bottom: { style: "thin", color: { argb: "FFEEEEEE" } },
      right: { style: "thin", color: { argb: "FFEEEEEE" } },
    };
  });

  if (crCol > 0) {
    row.getCell(crCol).numFmt = "0.00%";
  }
  if (crTargetCol > 0) {
    row.getCell(crTargetCol).numFmt = "0.00%";
  }
  if (crReachCol > 0) {
    setReachStyle(row.getCell(crReachCol), item.metrics?.crTargetReach);
  }
  if (ftdReachCol > 0) {
    setReachStyle(row.getCell(ftdReachCol), item.metrics?.ftdTargetReach);
  }
}

export async function buildReportWorkbookBuffer({ title = "CRM Report", mode = "full", rows = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");
  const columns = modeColumns(mode);
  worksheet.columns = columns;
  worksheet.views = [{ state: "frozen", ySplit: 2 }];

  const titleRow = worksheet.addRow([title]);
  worksheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  titleRow.height = 24;

  const headerRow = worksheet.addRow(columns.map((column) => column.header));
  styleHeaderRow(headerRow);

  for (const item of rows) {
    const data = baseRowData(item, mode);
    const row = worksheet.addRow(data);
    styleDataRow(worksheet, row, item, mode);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function styleMatrixHeaderCell(cell) {
  cell.font = { bold: true, color: { argb: "FF000000" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = {
    top: { style: "thin", color: { argb: "FFBDBDBD" } },
    left: { style: "thin", color: { argb: "FFBDBDBD" } },
    bottom: { style: "thin", color: { argb: "FFBDBDBD" } },
    right: { style: "thin", color: { argb: "FFBDBDBD" } },
  };
}

function styleMatrixDataCell(cell, { italic = true, percent = false } = {}) {
  cell.font = { ...(cell.font || {}), italic };
  if (percent && typeof cell.value === "number") {
    cell.numFmt = "0.00%";
  }
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = {
    top: { style: "thin", color: { argb: "FFEEEEEE" } },
    left: { style: "thin", color: { argb: "FFEEEEEE" } },
    bottom: { style: "thin", color: { argb: "FFEEEEEE" } },
    right: { style: "thin", color: { argb: "FFEEEEEE" } },
  };
}

function monthShortLabel(label = "") {
  const part = String(label).trim().split(/\s+/)[0];
  return part ? part.toUpperCase() : String(label || "").toUpperCase();
}

const DEFAULT_LAST4_ALL_METRIC_COLUMNS = [
  { key: "target", label: "TARGET", type: "number", width: 11 },
  { key: "ftd", label: "FTD", type: "number", width: 10 },
  { key: "cr", label: "CR%", type: "percent", width: 10 },
  { key: "crTarget", label: "CR TARGET", type: "percent", width: 12 },
  { key: "crTargetReach", label: "CR TARGET REACH", type: "reach_percent", width: 16 },
  { key: "ftdTargetReach", label: "FTD TARGET REACH", type: "reach_percent", width: 16 },
];

function setReachPercentStyle(cell, rawPercentValue) {
  if (!Number.isFinite(rawPercentValue)) {
    cell.value = "";
    cell.alignment = { vertical: "middle", horizontal: "center" };
    return;
  }
  cell.value = rawPercentValue / 100;
  cell.numFmt = "0.00%";
  cell.alignment = { vertical: "middle", horizontal: "center" };
  const reached = rawPercentValue >= 100;
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: reached ? "FF2E7D32" : "FFC62828" },
  };
  cell.font = {
    ...(cell.font || {}),
    color: { argb: "FFFFFFFF" },
    italic: true,
  };
}

function writeLast4AllSheet(
  worksheet,
  { infoColumns = [], months = [], rows = [], startRow = 1, metricColumns = DEFAULT_LAST4_ALL_METRIC_COLUMNS },
) {
  const infoCount = infoColumns.length;
  const metricCount = metricColumns.length;
  const totalMonthColumns = months.length * metricCount;
  const totalColumns = infoCount + totalMonthColumns;

  worksheet.views = [{ state: "frozen", ySplit: startRow + 1 }];
  worksheet.properties.defaultRowHeight = 20;

  for (let index = 0; index < infoColumns.length; index += 1) {
    worksheet.getColumn(index + 1).width = infoColumns[index].width || 18;
  }
  months.forEach((month, index) => {
    const start = infoCount + index * metricCount + 1;
    for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
      worksheet.getColumn(start + metricIndex).width = metricColumns[metricIndex]?.width || 12;
    }
    worksheet.mergeCells(startRow, start, startRow, start + metricCount - 1);
    const monthCell = worksheet.getCell(startRow, start);
    monthCell.value = monthShortLabel(month.label);
    styleMatrixHeaderCell(monthCell);
  });

  for (let index = 0; index < infoColumns.length; index += 1) {
    worksheet.mergeCells(startRow, index + 1, startRow + 1, index + 1);
    const infoCell = worksheet.getCell(startRow, index + 1);
    infoCell.value = infoColumns[index].label;
    styleMatrixHeaderCell(infoCell);
  }

  months.forEach((month, index) => {
    const start = infoCount + index * metricCount + 1;
    for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
      const headerCell = worksheet.getCell(startRow + 1, start + metricIndex);
      headerCell.value = metricColumns[metricIndex]?.label || "";
      styleMatrixHeaderCell(headerCell);
    }
  });

  if (totalColumns > 0) {
    for (let col = 1; col <= totalColumns; col += 1) {
      const row1Cell = worksheet.getCell(startRow, col);
      if (!row1Cell.value) {
        styleMatrixHeaderCell(row1Cell);
      }
      const row2Cell = worksheet.getCell(startRow + 1, col);
      if (!row2Cell.value) {
        styleMatrixHeaderCell(row2Cell);
      }
    }
  }

  rows.forEach((rowData) => {
    if (rowData.__separator) {
      const separatorRow = worksheet.addRow(Array(totalColumns).fill(""));
      separatorRow.height = 8;
      return;
    }
    const values = [];
    infoColumns.forEach((column) => {
      values.push(rowData[column.key] || "");
    });
    months.forEach((month) => {
      const metrics = rowData.monthMetrics?.[month.key] || {};
      for (const metricColumn of metricColumns) {
        const rawValue = metrics?.[metricColumn.key];
        if (metricColumn.type === "percent" || metricColumn.type === "reach_percent") {
          values.push(Number.isFinite(rawValue) ? rawValue / 100 : "");
        } else {
          values.push(Number.isFinite(rawValue) ? rawValue : "");
        }
      }
    });
    const row = worksheet.addRow(values);
    row.eachCell((cell, colIndex) => {
      const isInfo = colIndex <= infoCount;
      const metricOffset = colIndex - infoCount - 1;
      const metric = !isInfo ? metricColumns[metricOffset % metricCount] : null;
      const isPercent = metric?.type === "percent" || metric?.type === "reach_percent";
      styleMatrixDataCell(cell, { italic: !isInfo, percent: isPercent });
      if (isInfo) {
        cell.font = { ...(cell.font || {}), bold: true, italic: false };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        if (rowData.level === "Team Leader") {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFB3E5FC" },
          };
        }
      } else if (metric?.type === "reach_percent") {
        const rawPercent = typeof cell.value === "number" ? cell.value * 100 : null;
        setReachPercentStyle(cell, rawPercent);
      }
    });
  });
}

export async function buildLast4AllWorkbookBuffer({
  title = "Last 4 Months",
  months = [],
  sheets = [],
} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Agent Bot";

  if (!sheets.length) {
    const empty = workbook.addWorksheet("Report");
    empty.addRow([title]);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name || "Report");
    worksheet.addRow([`${title} - ${sheet.name || "Report"}`]);
    const metricColumns = sheet.metricColumns || DEFAULT_LAST4_ALL_METRIC_COLUMNS;
    worksheet.mergeCells(
      1,
      1,
      1,
      Math.max(1, (sheet.infoColumns?.length || 1) + months.length * metricColumns.length),
    );
    const titleCell = worksheet.getCell(1, 1);
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    worksheet.addRow([]);
    writeLast4AllSheet(worksheet, {
      infoColumns: sheet.infoColumns || [],
      months,
      rows: sheet.rows || [],
      startRow: 3,
      metricColumns,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
