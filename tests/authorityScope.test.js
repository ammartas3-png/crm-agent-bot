import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAuthorityScopeCache,
  computeAuthorityScopeFromRows,
  resolveAuthorityScopeForUser,
} from "../lib/authorityScope.js";

test("computeAuthorityScopeFromRows denies unknown user", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "100",
        Office: "Turkey Office",
        Desk: "Turkey English",
      },
    ],
    { id: 999, username: "none" },
  );
  assert.equal(scope.allowed, false);
});

test("computeAuthorityScopeFromRows parses office, desk and team leader filters", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "5674415901",
        Office: "Turkey Office",
        Desk: "Turkey English",
        Authority: "Team Leader: Rafik B",
      },
    ],
    { id: 5674415901, username: "dddzz8" },
  );
  assert.equal(scope.allowed, true);
  assert.deepEqual(scope.filters.office, ["Turkey Office"]);
  assert.deepEqual(scope.filters.department, ["Turkey English"]);
  assert.deepEqual(scope.filters.teamLeader, ["Rafik B"]);
});

test("computeAuthorityScopeFromRows handles all access rows", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "123",
        Office: "all",
        Desk: "all",
        Authority: "all",
      },
    ],
    { id: 123, username: "fulluser" },
  );
  assert.equal(scope.allowed, true);
  assert.equal(scope.unrestricted, true);
  assert.deepEqual(scope.filters, {});
});

test("resolveAuthorityScopeForUser reads rows via injected reader", async () => {
  clearAuthorityScopeCache();
  const scope = await resolveAuthorityScopeForUser(
    { id: 77, username: "reader" },
    {
      spreadsheetId: "authority-sheet",
      readRows: async () => [
        {
          "User Telegram ID": "77",
          Office: "Istanbul",
          Desk: "Desk A",
          Authority: "",
        },
      ],
    },
  );
  assert.equal(scope.allowed, true);
  assert.deepEqual(scope.filters.office, ["Istanbul"]);
  assert.deepEqual(scope.filters.department, ["Desk A"]);
});
