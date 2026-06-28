import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { buildLast4AllWorkbookBuffer } from "../lib/reportWorkbookExporter.js";

test("last4 workbook greys months before starting date", async () => {
  const months = [
    { key: "2026-02", label: "February 2026" },
    { key: "2026-03", label: "March 2026" },
    { key: "2026-05", label: "May 2026" },
  ];
  const buffer = await buildLast4AllWorkbookBuffer({
    title: "Last 4 Months",
    months,
    sheets: [
      {
        name: "ALL",
        infoColumns: [
          { key: "level", label: "Level", width: 14 },
          { key: "office", label: "Desk", width: 20 },
          { key: "teamLeader", label: "Team Leader", width: 20 },
          { key: "agent", label: "Agent", width: 20 },
        ],
        tailColumns: [{ key: "jobEntry", label: "Starting Date", width: 16 }],
        rows: [
          {
            level: "Agent",
            office: "Turkey French",
            teamLeader: "Rafik B",
            agent: "Ahmet",
            jobEntry: "15/05/2026",
            monthMetrics: {
              "2026-02": { target: 10, ftd: 1, cr: 10, crTarget: 10, crTargetReach: 100, ftdTargetReach: 100 },
              "2026-03": { target: 12, ftd: 1, cr: 8, crTarget: 10, crTargetReach: 80, ftdTargetReach: 80 },
              "2026-05": { target: 15, ftd: 1, cr: 7, crTarget: 10, crTargetReach: 70, ftdTargetReach: 70 },
            },
          },
        ],
      },
    ],
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("ALL");
  const dataRow = worksheet.getRow(5);
  // info columns = 4, metric columns per month = 6, target metric is first metric column in each month block
  const febTargetCell = dataRow.getCell(5);
  const marTargetCell = dataRow.getCell(11);
  const mayTargetCell = dataRow.getCell(17);
  assert.equal(febTargetCell.fill?.fgColor?.argb, "FFE0E0E0");
  assert.equal(marTargetCell.fill?.fgColor?.argb, "FFE0E0E0");
  assert.notEqual(mayTargetCell.fill?.fgColor?.argb, "FFE0E0E0");
});

