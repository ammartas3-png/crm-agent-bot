import assert from "node:assert/strict";
import test from "node:test";

import { pickDataTabs, scoreHeaderMatch } from "../lib/tabResolver.js";

const expectedColumns = ["ID", "Country", "FTD MAKER", "Lead Date", "FTD DATE", "Status"];

test("scoreHeaderMatch counts matching headers case-insensitively", () => {
  assert.equal(scoreHeaderMatch(["id", "country", "ftd maker"], expectedColumns), 3);
  assert.equal(scoreHeaderMatch(["Name", "Notes"], expectedColumns), 0);
  // Duplicate headers are only counted once.
  assert.equal(scoreHeaderMatch(["ID", "ID", "Country"], expectedColumns), 2);
});

test("pickDataTabs returns tabs above the threshold, best first", () => {
  const scored = [
    { title: "Summary", score: 1 },
    { title: "Leads", score: 6 },
    { title: "April Leads", score: 4 },
  ];
  assert.deepEqual(pickDataTabs(scored, { threshold: 3 }), ["Leads", "April Leads"]);
});

test("pickDataTabs falls back to the configured tab then the first tab", () => {
  const scored = [
    { title: "Notes", score: 1 },
    { title: "Leads", score: 2 },
  ];
  assert.deepEqual(pickDataTabs(scored, { threshold: 3, fallbackTab: "Leads" }), ["Leads"]);
  assert.deepEqual(pickDataTabs(scored, { threshold: 3 }), ["Notes"]);
  assert.deepEqual(pickDataTabs([], { threshold: 3 }), []);
});
