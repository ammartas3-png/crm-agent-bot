import assert from "node:assert/strict";
import test from "node:test";

import { abbreviateLanguage, buildDeskLanguageLabelMap, buildTeamRosterReport } from "../lib/teamRoster.js";

test("abbreviateLanguage maps full names and collapses compound values", () => {
  assert.equal(abbreviateLanguage("English"), "EN");
  assert.equal(abbreviateLanguage("English Africa"), "ENAF");
  assert.equal(abbreviateLanguage("Africa"), "ENAF");
  assert.equal(abbreviateLanguage("Arabic"), "AR");
  assert.equal(abbreviateLanguage("French"), "FR");
  assert.equal(abbreviateLanguage("Indonesia, Malaysia"), "ID");
  assert.equal(abbreviateLanguage("EN / AR"), "EN");
  assert.equal(abbreviateLanguage(""), "");
});

const languageRows = [
  { Desk: "Turkey English", Lang: "EN" },
  { Desk: "Turkey Arabic", Lang: "AR" },
];

const rosterRows = [
  { Agent: "Murat K", "Working Status": "Working", Desk: "Turkey English", "Team Leader": "Murat K" },
  { Agent: "Mehmet Ki", "Working Status": "Working", Desk: "Turkey English", "Team Leader": "Murat K" },
  { Agent: "Suayib Mo", "Working Status": "Not Working", Desk: "Turkey English", "Team Leader": "Murat K" },
  { Agent: "Fatma Aze", "Working Status": "Working", Desk: "Turkey Arabic", "Team Leader": "Fatma Aze" },
  { Agent: "Ahmed Ta", "Working Status": "Working", Desk: "Turkey Arabic", "Team Leader": "Fatma Aze" },
];

test("buildDeskLanguageLabelMap maps desk -> raw lang label", () => {
  const map = buildDeskLanguageLabelMap(languageRows);
  assert.equal(map.get("turkey english"), "EN");
  assert.equal(map.get("turkey arabic"), "AR");
});

test("buildTeamRosterReport groups by team leader with incl/excl TL counts", () => {
  const deskLangMap = buildDeskLanguageLabelMap(languageRows);
  const report = buildTeamRosterReport(rosterRows, { deskLangMap });

  assert.equal(report.teams.length, 2);
  const murat = report.teams[0];
  assert.equal(murat.teamLeader, "Murat K");
  assert.equal(murat.count, 3);
  assert.equal(murat.countExclTL, 2);
  assert.equal(murat.agents[0].language, "EN");
  assert.equal(murat.agents[0].isTeamLeader, true);

  const en = report.byLanguage.find((row) => row.language === "EN");
  assert.equal(en.inclTL, 3);
  assert.equal(en.exclTL, 2);
  const ar = report.byLanguage.find((row) => row.language === "AR");
  assert.equal(ar.inclTL, 2);
  assert.equal(ar.exclTL, 1);

  assert.equal(report.totals.inclTL, 5);
  assert.equal(report.totals.exclTL, 3);
});

test("buildTeamRosterReport working filter keeps only Working agents", () => {
  const deskLangMap = buildDeskLanguageLabelMap(languageRows);
  const report = buildTeamRosterReport(rosterRows, { deskLangMap, workingFilter: "working" });
  assert.equal(report.totals.inclTL, 4); // Suayib (Not Working) dropped
  assert.equal(report.totals.exclTL, 2);
  const murat = report.teams.find((team) => team.teamLeader === "Murat K");
  assert.equal(murat.count, 2);
});

test("buildTeamRosterReport leaves language blank when desk has no mapping", () => {
  const report = buildTeamRosterReport(
    [{ Agent: "Blank Desk", "Working Status": "Working", Desk: "", "Team Leader": "Some TL" }],
    { deskLangMap: buildDeskLanguageLabelMap(languageRows) },
  );
  assert.equal(report.teams[0].agents[0].language, "");
});
