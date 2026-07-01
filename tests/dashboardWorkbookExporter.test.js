import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { dashboardReportWorkbookBuffer } from "../lib/dashboardWorkbookExporter.js";

test("builder pivot export groups month headers on top row", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columnDimension: "month",
      columnValues: ["2026-03", "2026-04", "__grand_total__"],
      columnMetrics: [
        { key: "ftd", label: "FTD", type: "number" },
        { key: "ftdTargetReach", label: "FTD Target Reach", type: "percent" },
      ],
      columns: [
        { key: "desk", label: "Desk", type: "text", kind: "dimension" },
        { key: "agent", label: "Agent", type: "text", kind: "dimension" },
        { key: "month_2026-03__ftd", label: "2026-03 FTD", type: "number", kind: "metric" },
        { key: "month_2026-03__ftdTargetReach", label: "2026-03 FTD Target Reach", type: "percent", kind: "metric" },
        { key: "month_2026-04__ftd", label: "2026-04 FTD", type: "number", kind: "metric" },
        { key: "month_2026-04__ftdTargetReach", label: "2026-04 FTD Target Reach", type: "percent", kind: "metric" },
        { key: "month___grand_total____ftd", label: "Grand Total FTD", type: "number", kind: "metric" },
        {
          key: "month___grand_total____ftdTargetReach",
          label: "Grand Total FTD Target Reach",
          type: "percent",
          kind: "metric",
        },
        { key: "workStartDate", label: "Start Date", type: "text", kind: "worktime" },
      ],
    },
    table: [
      {
        desk: "Turkey",
        agent: "Agent One",
        "month_2026-03__ftd": 12,
        "month_2026-03__ftdTargetReach": 80,
        "month_2026-04__ftd": 18,
        "month_2026-04__ftdTargetReach": 120,
        "month___grand_total____ftd": 30,
        "month___grand_total____ftdTargetReach": 100,
        workStartDate: "2026-03-05",
      },
    ],
    month: { label: "June 2026", office_name: "Turkiye Office", key: "2026-06" },
    summary: {},
    reportMode: "specific",
    specificType: "builder",
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("C1").value, "2026-03");
  assert.equal(worksheet.getCell("E1").value, "2026-04");
  assert.equal(worksheet.getCell("G1").value, "Grand Total");
  assert.equal(worksheet.getCell("C2").value, "FTD");
  assert.equal(worksheet.getCell("D2").value, "FTD Target Reach");
  assert.equal(worksheet.getCell("E2").value, "FTD");
});

test("builder pivot export blanks months before work start", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columnDimension: "month",
      columnValues: ["2026-03", "2026-04"],
      columnMetrics: [{ key: "ftd", label: "FTD", type: "number" }],
      columns: [
        { key: "desk", label: "Desk", type: "text", kind: "dimension" },
        { key: "month_2026-03__ftd", label: "2026-03 FTD", type: "number", kind: "metric" },
        { key: "month_2026-04__ftd", label: "2026-04 FTD", type: "number", kind: "metric" },
        { key: "workStartDate", label: "Start Date", type: "text", kind: "worktime" },
      ],
    },
    table: [
      {
        desk: "Turkey",
        "month_2026-03__ftd": 20,
        "month_2026-04__ftd": 10,
        workStartDate: "2026-04-03",
      },
    ],
    month: { label: "June 2026", office_name: "Turkiye Office", key: "2026-06" },
    summary: {},
    reportMode: "specific",
    specificType: "builder",
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("B3").value, "");
  assert.equal(String(worksheet.getCell("B3").fill?.fgColor?.argb || ""), "FF6B7280");
  assert.equal(Number(worksheet.getCell("C3").value || 0), 10);
});

test("builder pivot export adds working position column in last4 quick mode", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columnDimension: "month",
      columnValues: ["2026-03"],
      columnMetrics: [{ key: "ftd", label: "FTD", type: "number" }],
      columns: [
        { key: "desk", label: "Desk", type: "text", kind: "dimension" },
        { key: "teamLeader", label: "Team Leader", type: "text", kind: "dimension" },
        { key: "agent", label: "Agent", type: "text", kind: "dimension" },
        { key: "month_2026-03__ftd", label: "2026-03 FTD", type: "number", kind: "metric" },
        { key: "workDays", label: "Days", type: "number", kind: "worktime" },
      ],
    },
    table: [
      {
        desk: "Turkey",
        teamLeader: "Alice",
        agent: "Alice",
        "month_2026-03__ftd": 12,
        workDays: 30,
      },
      {
        desk: "Turkey",
        teamLeader: "Alice",
        agent: "Bob",
        "month_2026-03__ftd": 7,
        workDays: 10,
      },
      {
        desk: "Turkey",
        teamLeader: "Alice",
        agent: "Carol",
        "month_2026-03__ftd": 9,
        workDays: 20,
      },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, { last4QuickMode: "1" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("A1").value, "Working Position");
  assert.equal(worksheet.getCell("A3").value, "Team Leader");
  assert.equal(worksheet.getCell("B1").value, "Desk");
  assert.equal(worksheet.getCell("D4").value, "Carol");
  assert.equal(worksheet.getCell("D5").value, "Bob");
  assert.equal(Number(worksheet.getColumn(5).width || 0), 15);
  assert.equal(Array.isArray(worksheet.views) ? Number(worksheet.views[0]?.ySplit || 0) : 0, 2);
});

test("agent productivity export renders country blocks with metric rows", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columnDimension: "month",
      columnValues: ["2026-06", "2026-07"],
      columns: [
        { key: "country", label: "Country", type: "text", kind: "dimension" },
        { key: "month_2026-06__leads", label: "2026-06 Leads", type: "number", kind: "metric" },
        { key: "month_2026-06__ftd", label: "2026-06 FTD", type: "number", kind: "metric" },
        { key: "month_2026-06__cr", label: "2026-06 CR", type: "percent", kind: "metric" },
        { key: "month_2026-06__crTarget", label: "2026-06 CR Target", type: "percent", kind: "metric" },
        { key: "month_2026-06__crTargetReach", label: "2026-06 CR Target Reach", type: "percent", kind: "metric" },
        { key: "month_2026-06__ftdTarget", label: "2026-06 FTD Target", type: "number", kind: "metric" },
        { key: "month_2026-06__agentCount", label: "2026-06 Agent Count", type: "number", kind: "metric" },
        { key: "month_2026-07__leads", label: "2026-07 Leads", type: "number", kind: "metric" },
        { key: "month_2026-07__ftd", label: "2026-07 FTD", type: "number", kind: "metric" },
        { key: "month_2026-07__cr", label: "2026-07 CR", type: "percent", kind: "metric" },
        { key: "month_2026-07__crTarget", label: "2026-07 CR Target", type: "percent", kind: "metric" },
        { key: "month_2026-07__crTargetReach", label: "2026-07 CR Target Reach", type: "percent", kind: "metric" },
        { key: "month_2026-07__ftdTarget", label: "2026-07 FTD Target", type: "number", kind: "metric" },
        { key: "month_2026-07__agentCount", label: "2026-07 Agent Count", type: "number", kind: "metric" },
      ],
    },
    table: [
      {
        country: "India",
        "month_2026-06__leads": 3000,
        "month_2026-06__ftd": 300,
        "month_2026-06__cr": 10,
        "month_2026-06__crTarget": 8,
        "month_2026-06__crTargetReach": 125,
        "month_2026-06__ftdTarget": 240,
        "month_2026-06__agentCount": 20,
        "month_2026-07__leads": 3100,
        "month_2026-07__ftd": 279,
        "month_2026-07__cr": 9,
        "month_2026-07__crTarget": 8,
        "month_2026-07__crTargetReach": 112.5,
        "month_2026-07__ftdTarget": 248,
        "month_2026-07__agentCount": 20,
      },
    ],
    options: {
      months: [
        { key: "2026-06", month_label: "June 2026" },
        { key: "2026-07", month_label: "July 2026" },
      ],
    },
  };

  const buffer = await dashboardReportWorkbookBuffer(report, { agentProductivityPlanMode: "1" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("A1").value, "India");
  assert.equal(worksheet.getCell("B2").value, "Jun-26");
  assert.equal(worksheet.getCell("A3").value, "Lead per agent according mark. Plan");
  assert.equal(worksheet.getCell("A4").value, "Daily leads per agent");
  assert.equal(worksheet.getCell("A7").value, "CR%");
  assert.equal(worksheet.getCell("A8").value, "PSPs working?");
  assert.equal(worksheet.getCell("B4").numFmt, "0.00");
  assert.equal(Number.isFinite(Number(worksheet.getCell("B4").value || 0)), true);
  assert.ok(worksheet.getCell("B3").value === "" || worksheet.getCell("B3").value === null);
  assert.ok(worksheet.getCell("B8").value === "" || worksheet.getCell("B8").value === null);
  assert.equal(
    Array.isArray(worksheet.views) ? worksheet.views.some((view) => String(view?.state || "") === "frozen") : false,
    false,
  );
});

test("last4 export uses grouped month headers and working position column", async () => {
  const report = {
    tableType: "last4_matrix",
    monthBlocks: [
      { key: "2026-03", label: "Mar-26" },
      { key: "2026-04", label: "Apr-26" },
    ],
    table: [
      {
        desk: "Turkey Africa",
        teamLeader: "Alice",
        agent: "Alice",
        startDate: "2026-04-10",
        months: {
          "2026-03": {
            target: 10,
            ftd: 8,
            cr: 4,
            crTarget: 5,
            crTargetReach: 80,
            ftdTargetReach: 80,
          },
          "2026-04": {
            target: 12,
            ftd: 11,
            cr: 5,
            crTarget: 5,
            crTargetReach: 100,
            ftdTargetReach: 92,
          },
        },
      },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("A1").value, "Working Position");
  assert.equal(worksheet.getCell("E1").value, "Mar-26");
  assert.equal(worksheet.getCell("E2").value, "FTD");
  assert.equal(worksheet.getCell("F2").value, "FTD Target");
  assert.equal(worksheet.getCell("G2").value, "FTD Target Reach");
  assert.equal(worksheet.getCell("A3").value, "Team Leader");
  assert.equal(worksheet.getCell("E3").value, "");
  assert.equal(String(worksheet.getCell("E3").fill?.fgColor?.argb || ""), "FF6B7280");
  assert.notEqual(
    String(worksheet.getCell("E1").fill?.fgColor?.argb || ""),
    String(worksheet.getCell("K1").fill?.fgColor?.argb || ""),
  );
});

test("excel export colors CR Target Reach above 200% as success", async () => {
  const report = {
    table: [
      {
        label: "Antigua",
        totalLeads: 124,
        totalFtd: 15,
        ftdTarget: 0,
        ftdTargetReach: 0,
        cr: 12.1,
        crTarget: 5,
        crTargetReach: 241.94,
        selfs: 0,
        lateFtd: 0,
      },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");
  const crReachCell = worksheet.getCell("H2");

  assert.equal(String(crReachCell.fill?.fgColor?.argb || ""), "FFDCFCE7");
  assert.equal(String(crReachCell.font?.color?.argb || ""), "FF166534");
});

test("excel export applies benchmark rate color bands", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columns: [
        { key: "desk", label: "Desk", type: "text", kind: "dimension" },
        { key: "ftdBenchmarkRate", label: "Benchmark Rate", type: "percent", kind: "metric" },
      ],
    },
    table: [
      { desk: "Green Desk", ftdBenchmarkRate: 115 },
      { desk: "Yellow Desk", ftdBenchmarkRate: 90 },
      { desk: "Orange Desk", ftdBenchmarkRate: 70 },
      { desk: "Red Desk", ftdBenchmarkRate: 40 },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(String(worksheet.getCell("B2").fill?.fgColor?.argb || ""), "FF16A34A");
  assert.equal(String(worksheet.getCell("B3").fill?.fgColor?.argb || ""), "FFFACC15");
  assert.equal(String(worksheet.getCell("B4").fill?.fgColor?.argb || ""), "FFF59E0B");
  assert.equal(String(worksheet.getCell("B5").fill?.fgColor?.argb || ""), "FFEF4444");
});

test("excel export formats Missing FTD with report style", async () => {
  const report = {
    tableType: "builder",
    builder: {
      columns: [
        { key: "country", label: "Country", type: "text", kind: "dimension" },
        { key: "missingFtd", label: "Missing FTD", type: "number", kind: "metric" },
      ],
    },
    table: [
      { country: "India", missingFtd: -8.8 },
      { country: "Japan", missingFtd: 9.1 },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Report");

  assert.equal(worksheet.getCell("B2").value, "+ 8,80 FTD");
  assert.equal(String(worksheet.getCell("B2").fill?.fgColor?.argb || ""), "FF14532D");
  assert.equal(worksheet.getCell("B3").value, "- 9,10 FTD");
  assert.equal(String(worksheet.getCell("B3").fill?.fgColor?.argb || ""), "FF7F1D1D");
});

test("comparison export writes six server-side comparison sheets", async () => {
  const report = {
    tableType: "builder",
    comparisonTables: [
      {
        key: "country",
        label: "Country",
        rows: [{ label: "India", leads: 100, ftd: 10, cr: 10, crTargetReach: 125 }],
      },
      {
        key: "agent",
        label: "Agent",
        rows: [{ label: "Agent One", leads: 50, ftd: 5, cr: 10, crTargetReach: 100 }],
      },
    ],
  };

  const buffer = await dashboardReportWorkbookBuffer(report, { comparisonMode: "1" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.equal(workbook.getWorksheet("Country")?.name, "Country");
  assert.equal(workbook.getWorksheet("Agent")?.name, "Agent");
  assert.equal(Number(workbook.getWorksheet("Country")?.getCell("B2").value || 0), 100);
  assert.equal(workbook.getWorksheet("Country")?.getCell("D1").value, "CR");
  assert.equal(workbook.getWorksheet("Country")?.getCell("E1").value, "CR Reach");
});
