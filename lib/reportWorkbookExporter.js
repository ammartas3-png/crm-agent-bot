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
      { header: "Name", key: "name", width: 28 },
      { header: "Month", key: "month", width: 12 },
      { header: "Target", key: "target", width: 12 },
      { header: "FTD", key: "ftd", width: 12 },
      { header: "CR", key: "cr", width: 12 },
      { header: "CR Target Reach", key: "crTargetReach", width: 18 },
      { header: "FTD Target Reach", key: "ftdTargetReach", width: 18 },
    ];
  }
  return [
    { header: "Name", key: "name", width: 28 },
    { header: "Month", key: "month", width: 12 },
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
      name: item.kind === "month" ? "" : item.name || "",
      month: item.month || "",
      target: Number.isFinite(metrics.ftdTarget) ? metrics.ftdTarget : "-",
      ftd: Number.isFinite(metrics.ftd) ? metrics.ftd : 0,
      cr: percentCellValue(metrics.cr),
      crTargetReach: metrics.crTargetReach,
      ftdTargetReach: metrics.ftdTargetReach,
    };
  }
  return {
    name: item.kind === "month" ? "" : item.name || "",
    month: item.month || "",
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
  const nameCol = columns.findIndex((column) => column.key === "name") + 1;
  const crCol = columns.findIndex((column) => column.key === "cr") + 1;
  const crTargetCol = columns.findIndex((column) => column.key === "crTarget") + 1;
  const crReachCol = columns.findIndex((column) => column.key === "crTargetReach") + 1;
  const ftdReachCol = columns.findIndex((column) => column.key === "ftdTargetReach") + 1;

  if (nameCol > 0 && item.kind !== "month") {
    const nameCell = row.getCell(nameCol);
    nameCell.font = { bold: item.kind === "group" || item.kind === "summary" };
  }

  row.eachCell((cell, colNumber) => {
    if (colNumber !== nameCol) {
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

function writeLast4AllSheet(worksheet, { infoColumns = [], months = [], rows = [], startRow = 1 }) {
  const infoCount = infoColumns.length;
  const totalMonthColumns = months.length * 3;
  const totalColumns = infoCount + totalMonthColumns;

  worksheet.views = [{ state: "frozen", ySplit: startRow + 1 }];
  worksheet.properties.defaultRowHeight = 20;

  for (let index = 0; index < infoColumns.length; index += 1) {
    worksheet.getColumn(index + 1).width = infoColumns[index].width || 18;
  }
  months.forEach((month, index) => {
    const start = infoCount + index * 3 + 1;
    worksheet.getColumn(start).width = 12;
    worksheet.getColumn(start + 1).width = 12;
    worksheet.getColumn(start + 2).width = 12;
    worksheet.mergeCells(startRow, start, startRow, start + 2);
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
    const start = infoCount + index * 3 + 1;
    const targetHeader = worksheet.getCell(startRow + 1, start);
    targetHeader.value = "TARGET";
    styleMatrixHeaderCell(targetHeader);
    const ftdHeader = worksheet.getCell(startRow + 1, start + 1);
    ftdHeader.value = "FTD";
    styleMatrixHeaderCell(ftdHeader);
    const crHeader = worksheet.getCell(startRow + 1, start + 2);
    crHeader.value = "CR%";
    styleMatrixHeaderCell(crHeader);
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
    const values = [];
    infoColumns.forEach((column) => {
      values.push(rowData[column.key] || "");
    });
    months.forEach((month) => {
      const metrics = rowData.monthMetrics?.[month.key] || {};
      values.push(Number.isFinite(metrics.target) ? metrics.target : "");
      values.push(Number.isFinite(metrics.ftd) ? metrics.ftd : 0);
      values.push(Number.isFinite(metrics.cr) ? metrics.cr / 100 : "");
    });
    const row = worksheet.addRow(values);
    row.eachCell((cell, colIndex) => {
      const isInfo = colIndex <= infoCount;
      const isCrColumn = !isInfo && (colIndex - infoCount) % 3 === 0;
      styleMatrixDataCell(cell, { italic: !isInfo, percent: isCrColumn });
      if (isInfo) {
        cell.font = { ...(cell.font || {}), bold: true, italic: false };
        cell.alignment = { vertical: "middle", horizontal: "left" };
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
    worksheet.mergeCells(1, 1, 1, Math.max(1, (sheet.infoColumns?.length || 1) + months.length * 3));
    const titleCell = worksheet.getCell(1, 1);
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    worksheet.addRow([]);
    writeLast4AllSheet(worksheet, {
      infoColumns: sheet.infoColumns || [],
      months,
      rows: sheet.rows || [],
      startRow: 3,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
