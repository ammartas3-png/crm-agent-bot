import assert from "node:assert/strict";
import test from "node:test";

import { buildHelpText, isHelpCommand } from "../lib/help.js";

test("isHelpCommand matches command variants", () => {
  assert.equal(isHelpCommand("/help"), true);
  assert.equal(isHelpCommand("help"), true);
  assert.equal(isHelpCommand("/help@crm_bot"), true);
  assert.equal(isHelpCommand("/help details"), true);
  assert.equal(isHelpCommand("hello"), false);
});

test("buildHelpText for regular user shows restricted sections", () => {
  const text = buildHelpText({ username: "regular-user" });

  assert.match(text, /CRM Bot Help/);
  assert.match(text, /Database Check \(admin-only\)/);
  assert.doesNotMatch(text, /Database Check flow \(admin\):/);
  assert.doesNotMatch(text, /Settings \(only @antoniotsd\):/);
});

test("buildHelpText for admin includes admin navigation", () => {
  const text = buildHelpText({ username: "cuervo0o0o" });

  assert.match(text, /Database Check flow \(admin\):/);
  assert.match(text, /\/debug_totals/);
  assert.doesNotMatch(text, /Settings \(only @antoniotsd\):/);
});

test("buildHelpText for settings admin includes month settings", () => {
  const text = buildHelpText({ username: "antoniotsd" });

  assert.match(text, /Settings \(only @antoniotsd\):/);
  assert.match(text, /Add \/ Update Month File/);
});
