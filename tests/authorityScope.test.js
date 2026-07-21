import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAuthorityScopeCache,
  computeAuthorityScopeFromRows,
  resolveAuthorityScopeForUser,
} from "../lib/authorityScope.js";

test("resolveAuthorityScopeForUser grants ALL authority to configured admins", async () => {
  clearAuthorityScopeCache();
  // Admin via username and via numeric ID (no Bot Authority sheet read needed).
  const byUsername = await resolveAuthorityScopeForUser({ id: 1, username: "antoniotsd" });
  assert.equal(byUsername.allowed, true);
  assert.equal(byUsername.unrestricted, true);

  const byId = await resolveAuthorityScopeForUser({ id: 1240141730 });
  assert.equal(byId.allowed, true);
  assert.equal(byId.unrestricted, true);
});

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
        Team: "Rafik B",
        Authority: "team leader",
      },
    ],
    { id: 5674415901, username: "dddzz8" },
  );
  assert.equal(scope.allowed, true);
  assert.deepEqual(scope.filters.office, ["Turkey Office"]);
  assert.deepEqual(scope.filters.desk, ["Turkey English"]);
  assert.deepEqual(scope.filters.officeOrDepartment, ["Turkey English"]);
  assert.deepEqual(scope.filters.teamLeader, ["Rafik B"]);
});

test("computeAuthorityScopeFromRows ignores team filter for CRM role", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "88",
        Office: "Turkey Office",
        Desk: "Turkey English",
        Team: "Rafik B",
        Authority: "crm",
      },
    ],
    { id: 88, username: "crm-user" },
  );
  assert.equal(scope.allowed, true);
  assert.equal(Boolean(scope.filters.teamLeader), false);
});

test("computeAuthorityScopeFromRows applies team filter for Desk Manager role", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "89",
        Office: "Turkey Office",
        Desk: "Turkey English",
        Team: "Rafik B",
        Authority: "Desk Manager",
      },
    ],
    { id: 89, username: "desk-manager-user" },
  );
  assert.equal(scope.allowed, true);
  assert.deepEqual(scope.filters.teamLeader, ["Rafik B"]);
});

test("computeAuthorityScopeFromRows handles all access rows with office desk team scope", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram": "ggggnsss",
        Office: "Dubai Office",
        Desk: "AE Indonesia, AE Malaysian",
        Team: "Sofia",
        Authority: "all",
      },
    ],
    { id: 5061394895, username: "ggggnsss" },
  );
  assert.equal(scope.allowed, true);
  assert.equal(scope.botReportAccess, true);
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.filters.office, ["Dubai Office"]);
  assert.deepEqual(scope.filters.desk, ["AE Indonesia", "AE Malaysian"]);
  assert.deepEqual(scope.filters.teamLeader, ["Sofia"]);
});

test("computeAuthorityScopeFromRows denies bot reports for manager role but keeps scope filters", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram": "SandyRat56",
        Office: "Dubai Office",
        Desk: "AE Indonesia",
        Team: "Sofia",
        Authority: "Manager",
      },
    ],
    { id: 7371996588, username: "SandyRat56" },
  );
  assert.equal(scope.allowed, true);
  assert.equal(scope.botReportAccess, false);
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.filters.office, ["Dubai Office"]);
  assert.deepEqual(scope.filters.desk, ["AE Indonesia"]);
  assert.deepEqual(scope.filters.teamLeader, ["Sofia"]);
});

test("computeAuthorityScopeFromRows ignores sheet formula errors in team values", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "123",
        Office: "Dubai Office",
        Desk: "AE Indonesia",
        Team: "#N/A (Did not find value 'Gayenur S' in VLOOKUP evaluation.), Sofia",
        Authority: "all",
      },
    ],
    { id: 123, username: "fulluser" },
  );
  assert.deepEqual(scope.filters.teamLeader, ["Sofia"]);
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
  assert.deepEqual(scope.filters.desk, ["Desk A"]);
  assert.deepEqual(scope.filters.officeOrDepartment, ["Desk A"]);
});
