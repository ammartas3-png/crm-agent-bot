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
