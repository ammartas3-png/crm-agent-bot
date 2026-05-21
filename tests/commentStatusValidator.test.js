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

test("validator parses multiline prefixed comments before matching rules", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments":
        "2026-05-21 8:51 | Dilan Ka | customer asked to call\n tomorrow after work",
    },
  ];
  const result = validateCommentStatusRows(rows, rules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "Call Again");
  assert.equal(
    result.flaggedRows[0]["Last Relevant Comment"],
    "customer asked to call tomorrow after work",
  );
});

test("validator uses latest comment status match for final suggestion", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments":
        "2026-05-21 08:51 | Dilan Ka | call tomorrow\n2026-05-21 09:10 | Dilan Ka | not interested",
    },
  ];
  const result = validateCommentStatusRows(rows, rules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "No Interest");
  assert.equal(result.flaggedRows[0]["Last Relevant Comment"], "not interested");
});

test("validator sorts by timestamp and still uses newest comment", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments":
        "2026-05-21 09:10 | Dilan Ka | not interested\n2026-05-21 08:51 | Dilan Ka | call tomorrow",
    },
  ];
  const result = validateCommentStatusRows(rows, rules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "No Interest");
  assert.equal(result.flaggedRows[0]["Last Relevant Comment"], "not interested");
});

test("validator ignores incoming email blocks and does not force call again from older text", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments": `2026-05-20 16:22 | Goksel Tu | he said i dont want calls or emails thanks hu;\n2026-05-20 16:20 | Goksel Tu | he said i dont calls or emails thanks hu;\n2026-05-20 14:14 | Oktay Ra | incoming email:\n20/05/2026\nHeinz Hassler\nToday 15:47`,
    },
  ];
  const customRules = [
    {
      status: "Recall",
      positiveKeywords: ["dont call"],
      negativeKeywords: [],
      priority: 1,
      active: true,
    },
    {
      status: "Call Again",
      positiveKeywords: ["today"],
      negativeKeywords: [],
      priority: 2,
      active: true,
    },
  ];

  const result = validateCommentStatusRows(rows, customRules);
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "Recall");
  assert.equal(result.flaggedRows[0]["Review Type"], "Status Change Suggested");
  assert.equal(
    result.flaggedRows[0]["Last Relevant Comment"],
    "he said i dont want calls or emails thanks hu;",
  );
});

test("validator can infer status from Sheet1 hints when Sheet2 rule does not match", () => {
  const rows = [
    {
      "Customer Status": "Potential",
      "Last 10 Comments": "2026-05-21 10:10 | Agent | client not interested and refused service",
    },
  ];
  const result = validateCommentStatusRows(rows, [], {
    statusHints: [{ status: "No Interest", description: "client not interested refused service" }],
  });
  assert.equal(result.flaggedRows.length, 1);
  assert.equal(result.flaggedRows[0]["Suggested Status"], "No Interest");
  assert.match(result.flaggedRows[0].Reason, /Sheet1 status description/i);
});
