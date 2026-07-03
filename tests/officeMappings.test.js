import assert from "node:assert/strict";
import test from "node:test";

import { resolveOfficeNameForMonthMap, officeCountryFromName } from "../lib/officeMappings.js";
import { rosterTabNameForOffice } from "../lib/rosterConfig.js";

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

test("Tunisian Office is recognized as the Tunisia country", () => {
  assert.equal(officeCountryFromName("Tunisian Office"), "Tunisia");
  assert.equal(officeCountryFromName("tunisia"), "Tunisia");
});

test("Tunisian Office resolves to the Tunisia roster tab", () => {
  assert.equal(rosterTabNameForOffice("Tunisian Office"), "Tunisia");
  assert.equal(rosterTabNameForOffice("tunis"), "Tunisia");
  assert.equal(rosterTabNameForOffice("Turkiye Office"), "Turkiye");
});
