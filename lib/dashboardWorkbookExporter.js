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
}

function addBuilderTableSheet(workbook, report = {}) {
  const worksheet = workbook.addWorksheet("Report");
  const builderColumns = report?.builder?.columns || [];
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

