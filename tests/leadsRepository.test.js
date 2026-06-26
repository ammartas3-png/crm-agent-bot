import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchLeadRows,
  listDistinctValues,
  replaceSourceRows,
} from "../lib/leadsRepository.js";

function fakeClient(responses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    },
  };
}

test("fetchLeadRows without a date scope selects every row", async () => {
  const client = fakeClient([{ rows: [{ data: { ID: "1" } }, { data: { ID: "2" } }] }]);
  const rows = await fetchLeadRows({}, { client });

  assert.deepEqual(rows, [{ ID: "1" }, { ID: "2" }]);
  assert.match(client.calls[0].text, /SELECT data FROM lead_rows/);
  assert.doesNotMatch(client.calls[0].text, /WHERE/);
});

test("fetchLeadRows pushes a lead/FTD date union to SQL", async () => {
  const client = fakeClient([{ rows: [] }]);
  await fetchLeadRows({ dateStart: "2026-05-01", dateEnd: "2026-05-31" }, { client });

  const { text, params } = client.calls[0];
  assert.match(text, /lead_date >= \$1 AND lead_date < \$2/);
  assert.match(text, /ftd_date >= \$3 AND ftd_date < \$4/);
  assert.match(text, /OR/);
  // End boundary is exclusive next-day midnight so the whole end day is included.
  assert.equal(params[0], new Date(Date.UTC(2026, 4, 1)).toISOString());
  assert.equal(params[1], new Date(Date.UTC(2026, 5, 1)).toISOString());
});

test("listDistinctValues uses an indexed column or a JSON key", async () => {
  const indexedClient = fakeClient([{ rows: [{ value: "Istanbul" }, { value: "Ankara" }] }]);
  const offices = await listDistinctValues("office", { client: indexedClient });
  assert.deepEqual(offices, ["Istanbul", "Ankara"]);
  assert.match(indexedClient.calls[0].text, /SELECT DISTINCT office/);

  const jsonClient = fakeClient([{ rows: [{ value: "Ahmet" }] }]);
  const agents = await listDistinctValues("agentNames", {
    client: jsonClient,
    jsonKey: "AGENT NAMES",
  });
  assert.deepEqual(agents, ["Ahmet"]);
  assert.match(jsonClient.calls[0].text, /data->>'AGENT NAMES'/);
});

test("replaceSourceRows deletes the old snapshot, inserts rows, and upserts the source", async () => {
  const client = fakeClient([{ rows: [] }, { rows: [] }, { rows: [] }]);
  const records = [
    {
      sourceKey: "s",
      office: "HQ",
      period: "2026-05",
      leadId: "1",
      country: "Turkey",
      leadDate: null,
      ftdDate: null,
      created: null,
      data: { ID: "1" },
    },
  ];

  const result = await replaceSourceRows("s", { office: "HQ", period: "2026-05" }, records, {
    client,
  });

  assert.equal(result.rowCount, 1);
  assert.match(client.calls[0].text, /DELETE FROM lead_rows WHERE source_key = \$1/);
  assert.match(client.calls[1].text, /INSERT INTO lead_rows/);
  assert.match(client.calls[1].text, /::jsonb/);
  assert.match(client.calls[2].text, /INSERT INTO lead_sources/);
  assert.match(client.calls[2].text, /ON CONFLICT \(source_key\) DO UPDATE/);
});
