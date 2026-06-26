import assert from "node:assert/strict";
import test from "node:test";

import {
  officeSlug,
  parseMonthLabel,
  parseOfficeSourcesFromValues,
  parseSpreadsheetId,
  parseUsersFromValues,
} from "../lib/registry.js";

test("officeSlug builds a stable kebab-case slug", () => {
  assert.equal(officeSlug("Turkiye Office"), "turkiye-office");
  assert.equal(officeSlug("  Dubai  Office "), "dubai-office");
});

test("parseMonthLabel handles two- and four-digit years", () => {
  assert.deepEqual(parseMonthLabel("January 26"), { period: "2026-01", month: 0, year: 2026 });
  assert.deepEqual(parseMonthLabel("March 2026"), { period: "2026-03", month: 2, year: 2026 });
  assert.equal(parseMonthLabel("Office"), null);
  assert.equal(parseMonthLabel("January"), null);
});

test("parseSpreadsheetId accepts URLs and bare IDs", () => {
  assert.equal(
    parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1mwnrhktfXR_E7R15-4uDDk4FG9/edit#gid=0"),
    "1mwnrhktfXR_E7R15-4uDDk4FG9",
  );
  assert.equal(parseSpreadsheetId("1G6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0abcdef"), "1G6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0abcdef");
  assert.equal(parseSpreadsheetId(""), null);
  assert.equal(parseSpreadsheetId("not an id"), null);
});

test("parseOfficeSourcesFromValues maps office x month cells to sources", () => {
  const values = [
    ["Office", "January 26", "February 26", "March 26"],
    ["Turkiye Office", "1G6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0aaaaaa", "", "1tbdyjZIJLZby9azuDxxxxxxxxxxxxxxxxxxxx"],
    ["Dubai Office", "", "", "1eChagMjWy7jeArMyDCWxxxxxxxxxxxxxxxxxx"],
    ["", "ignored", "", ""],
  ];

  const sources = parseOfficeSourcesFromValues(values, { dataTab: "Leads", dataRange: "'Leads'!A:Y" });

  assert.deepEqual(
    sources.map((source) => `${source.sourceKey}:${source.spreadsheetId}`),
    [
      "turkiye-office:2026-01:leads:1G6f2xs8jRL6MMNwLMM4is-mdMBMCR_k4EW0aaaaaa",
      "turkiye-office:2026-03:leads:1tbdyjZIJLZby9azuDxxxxxxxxxxxxxxxxxxxx",
      "dubai-office:2026-03:leads:1eChagMjWy7jeArMyDCWxxxxxxxxxxxxxxxxxx",
    ],
  );
  assert.equal(sources[0].sheetName, "Leads");
  assert.equal(sources[0].range, "'Leads'!A:Y");
  assert.equal(sources[0].monthLabel, "January 26");
});

test("parseUsersFromValues skips a header row and collects principals", () => {
  const withHeader = [["Username", "Telegram ID"], ["@antoniotsd", "123"], ["@cuervo", "456"]];
  assert.deepEqual(parseUsersFromValues(withHeader), ["@antoniotsd", "123", "@cuervo", "456"]);

  const noHeader = [["111"], ["222"]];
  assert.deepEqual(parseUsersFromValues(noHeader), ["111", "222"]);
});
