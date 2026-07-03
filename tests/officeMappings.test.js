import assert from "node:assert/strict";
import test from "node:test";

import { resolveOfficeNameForMonthMap } from "../lib/officeMappings.js";

const sampleOfficeMap = {
  offices: ["Argentina Office", "Dubai Office", "Turkiye Office"],
  officesByCountry: {
    Argentina: ["Argentina Office"],
    "United Arab Emirates": ["Dubai Office"],
  },
  byOffice: {
    "Argentina Office": [{ key: "2026-06", sheet_id: "arg-june" }],
    "Dubai Office": [{ key: "2026-06", sheet_id: "dubai-june" }],
  },
};

test("resolveOfficeNameForMonthMap maps country labels to canonical office names", () => {
  assert.equal(resolveOfficeNameForMonthMap("Argentina Office", sampleOfficeMap), "Argentina Office");
  assert.equal(resolveOfficeNameForMonthMap("Argentina", sampleOfficeMap), "Argentina Office");
  assert.equal(resolveOfficeNameForMonthMap("United Arab Emirates", sampleOfficeMap), "Dubai Office");
});
