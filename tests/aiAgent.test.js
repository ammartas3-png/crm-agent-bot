import test from "node:test";
import assert from "node:assert/strict";

import { buildAnswerContext, detectLanguage, resolveEntity, refusalMessage } from "../lib/aiAgent.js";
import { getTabConfig } from "../config/sheetsConfig.js";

const tabConfig = getTabConfig("leads");
const NOW = new Date("2026-06-30T00:00:00Z");

let idCounter = 0;
function row({ country, campaign = "Camp A", status, agent, leader = "Leader 1", desk = "Istanbul", ftd = false }) {
  idCounter += 1;
  const record = {
    ID: `L-${idCounter}`,
    Country: country,
    Campaign: campaign,
    Status: status,
    "AGENT NAMES": agent,
    "Team Leader": leader,
    Desk: desk,
    "CR TARGET": "10%",
    Created: "10/06/2026 10:00:00",
    "Lead Date": "10/06/2026 10:00:00",
  };
  if (ftd) {
    record.FTD = "1";
    record["FTD MAKER"] = "closer";
    record["FTD DATE"] = "11/06/2026 12:00:00";
  }
  return record;
}

// Ali: strong in Germany (FTDs, but lots of No Answer), weak in Turkey (Call Again, no FTD).
const rows = [
  ...Array.from({ length: 5 }, (_, index) =>
    row({ country: "Germany", status: "No Answer", agent: "Ali", ftd: index < 2 }),
  ),
  ...Array.from({ length: 5 }, () => row({ country: "Turkey", status: "Call Again", agent: "Ali" })),
  ...Array.from({ length: 4 }, (_, index) =>
    row({ country: "Germany", status: "New", agent: "Mehmet", ftd: index < 1 }),
  ),
];

test("detectLanguage recognizes Turkish, English and Arabic", () => {
  assert.equal(detectLanguage("Ali ajanı nasıl?"), "tr");
  assert.equal(detectLanguage("How is agent Ali doing?"), "en");
  assert.equal(detectLanguage("كيف حال الوكيل"), "ar");
});

test("out-of-scope questions are refused in the user's language without OpenAI", () => {
  const context = buildAnswerContext({ question: "Bana bir şiir yaz", rows, tabConfig, now: NOW });
  assert.equal(context.outOfScope, true);
  assert.equal(context.language, "tr");
  assert.equal(context.refusal, refusalMessage("tr"));
  assert.equal(context.messages, undefined, "no OpenAI messages for refusals");
});

test("resolveEntity finds the agent mentioned in the question", () => {
  const entity = resolveEntity("Ali nasıl performans gösteriyor?", rows, tabConfig);
  assert.equal(entity.type, "agent");
  assert.equal(entity.value, "Ali");
});

test("agent question yields a country/campaign profile with status issue shares", () => {
  const context = buildAnswerContext({ question: "Ali ajanı hangi ülkede iyi?", rows, tabConfig, now: NOW });
  assert.equal(context.outOfScope, false);
  assert.equal(context.intent.entityType, "agent");
  assert.equal(context.facts.entity, "Ali");
  assert.equal(context.facts.totals.leads, 10);
  assert.equal(context.facts.totals.ftd, 2);
  assert.ok(Array.isArray(context.facts.byCountry) && context.facts.byCountry.length >= 2);
  // No Answer (Germany) + Call Again (Turkey) split the statuses.
  assert.ok(context.facts.noAnswerShare > 0, "no-answer share should be detected");
  assert.ok(context.facts.callAgainShare > 0, "call-again share should be detected");
  assert.ok(context.draftAnswer.includes("Ali"));
  assert.equal(context.messages.length, 2, "system + user message for OpenAI");
});

test("desk question lists the teams working under it", () => {
  const context = buildAnswerContext({ question: "Istanbul masasında kimler var?", rows, tabConfig, now: NOW });
  assert.equal(context.intent.entityType, "desk");
  assert.ok(Array.isArray(context.facts.teamLeaders));
  assert.ok(context.facts.teamLeaders.some((item) => item.label === "Leader 1"));
});

test("a metric question without an entity returns an overview profile", () => {
  const context = buildAnswerContext({ question: "How many FTD today?", rows, tabConfig, now: NOW });
  assert.equal(context.outOfScope, false);
  assert.equal(context.facts.entityType, "overview");
  assert.ok(Array.isArray(context.facts.topCountries));
});
