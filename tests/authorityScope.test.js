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

test("computeAuthorityScopeFromRows treats pending authority as not allowed", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "555",
        Office: "all",
        Desk: "all",
        Authority: "pending",
      },
    ],
    { id: 555, username: "pending-user" },
  );
  assert.equal(scope.allowed, false);
  assert.equal(scope.pending, true);
});

test("computeAuthorityScopeFromRows prefers latest matching row", () => {
  const scope = computeAuthorityScopeFromRows(
    [
      {
        "User Telegram ID": "321",
        Office: "all",
        Desk: "all",
        Authority: "all",
      },
      {
        "User Telegram ID": "321",
        Office: "Turkiye Office",
        Desk: "Turkey English",
        Team: "Anas B",
        Authority: "Desk Manager",
      },
    ],
    { id: 321, username: "limited-user" },
  );
  assert.equal(scope.allowed, true);
  assert.equal(scope.unrestricted, false);
  assert.deepEqual(scope.filters.office, ["Turkiye Office"]);
  assert.deepEqual(scope.filters.desk, ["Turkey English"]);
  assert.deepEqual(scope.filters.teamLeader, ["Anas B"]);
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

test("resolveAuthorityScopeForUser grants ALL scope for admins", async () => {
  clearAuthorityScopeCache();
  const scope = await resolveAuthorityScopeForUser(
    { username: "antoniotsd" },
    {
      spreadsheetId: "authority-sheet",
      readRows: async () => {
        throw new Error("readRows should not be called for admins");
      },
    },
  );
  assert.equal(scope.allowed, true);
  assert.equal(scope.unrestricted, true);
  assert.deepEqual(scope.filters, {});
});
