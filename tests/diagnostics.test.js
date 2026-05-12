import assert from "node:assert/strict";
import test from "node:test";

import { formatSheetsDiagnostic, safeError } from "../lib/diagnostics.js";

test("safeError returns a short safe error payload", () => {
  const error = new Error("Google Sheets API has not been used in project");
  error.code = 403;

  assert.deepEqual(safeError(error), {
    name: "Error",
    message: "Google Sheets API has not been used in project",
    code: 403,
  });
});

test("formatSheetsDiagnostic explains failed Sheets checks", () => {
  const message = formatSheetsDiagnostic({
    ok: false,
    error: {
      message: "Unable to parse range",
      code: 400,
    },
    config: {
      leadsRange: "'May 26 Turkey  Leads'!A:W",
      serviceAccountEmail: "matservice@mitservice.iam.gserviceaccount.com",
    },
  });

  assert.match(message, /Sheets diagnostic: FAILED/);
  assert.match(message, /Unable to parse range/);
  assert.match(message, /tab name\/range is wrong/);
});

test("formatSheetsDiagnostic summarizes successful Sheets checks", () => {
  const message = formatSheetsDiagnostic({
    ok: true,
    rowCount: 3,
    firstRowColumns: ["Brand", "ID"],
    config: {
      leadsRange: "'May 26 Turkey  Leads'!A:W",
      serviceAccountEmail: "matservice@mitservice.iam.gserviceaccount.com",
    },
  });

  assert.match(message, /Sheets diagnostic: OK/);
  assert.match(message, /Rows read: 3/);
  assert.match(message, /Columns: Brand, ID/);
});
