import assert from "node:assert/strict";
import test from "node:test";

import { validateCommentStatusRows } from "../lib/commentStatusValidator.js";

const rules = [
  {
    status: "Call Again",
    positiveKeywords: ["call tomorrow", "call back"],
    negativeKeywords: [],
    priority: 1,
    active: true,
  },
  {
    status: "No Interest",
    positiveKeywords: ["not interested"],
    negativeKeywords: [],
    priority: 2,
    active: true,
  },
];

test("validator ignores system comments and flags manual check when no match", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments": "2026-05-14 8:28 | Agent | Email ABC was sent by system",
    },
    {
      "Customer Status": "Potential",
      "Last 10 Comments": "2026-05-14 8:28 | Agent | talked generally",
    },
  ];
  const result = validateCommentStatusRows(rows, rules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Review Type"], "Manual Check");
});

test("validator suggests status change by keyword and appointment signal", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Voip Calls Attempts Cnt": "0",
      "Voip Calls Duration in Seconds": "0",
      "Last 10 Comments": "2026-05-14 8:28 | Agent | cx said call tmrw at 15:00",
    },
  ];
  const result = validateCommentStatusRows(rows, rules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "Call Again");
  assert.equal(result.flaggedRows[0]["Appointment Detected"], "YES");
});
