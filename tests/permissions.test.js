import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ADMIN_USERS,
  SETTINGS_ADMIN_USER,
  approveTelegramUser,
  clearRuntimeApprovals,
  getTelegramUserRole,
  isAdminTelegramUser,
  isAllowedTelegramUser,
  isSettingsAdminTelegramUser,
  listRuntimeApprovals,
  parseAdminChatIds,
  parseAdminUsers,
  parseAllowedUsers,
} from "../lib/permissions.js";

test("parseAllowedUsers reads comma-separated Telegram IDs", () => {
  const users = parseAllowedUsers("123, 456,789");

  assert.equal(users.has("123"), true);
  assert.equal(users.has("456"), true);
  assert.equal(users.has("789"), true);
});

test("parseAllowedUsers supports newline and semicolon separators", () => {
  const users = parseAllowedUsers("123\n456;789 101");

  assert.equal(users.has("123"), true);
  assert.equal(users.has("456"), true);
  assert.equal(users.has("789"), true);
  assert.equal(users.has("101"), true);
});

test("parseAdminUsers normalizes usernames with @ prefix", () => {
  const users = parseAdminUsers("@antoniotsd, OtherAdmin");

  assert.equal(users.has("antoniotsd"), true);
  assert.equal(users.has("otheradmin"), true);
});

test("parseAdminUsers always includes default admins", () => {
  const users = parseAdminUsers("@customadmin");

  assert.equal(users.has("customadmin"), true);
  assert.equal(users.has("antoniotsd"), true);
  assert.equal(users.has("cuervo0o0o"), true);
  assert.equal(users.has("talhapervaiz97"), true);
});

test("parseAdminChatIds reads comma-separated chat IDs", () => {
  assert.deepEqual(parseAdminChatIds("111, 222"), ["111", "222"]);
});

test("isAllowedTelegramUser denies empty config by default", () => {
  assert.equal(isAllowedTelegramUser(123, new Set(), new Set()), false);
});

test("isAllowedTelegramUser compares IDs as strings", () => {
  assert.equal(isAllowedTelegramUser(123, new Set(["123"]), new Set()), true);
  assert.equal(isAllowedTelegramUser(999, new Set(["123"]), new Set()), false);
});

test("default admin users include configured admins", () => {
  assert.deepEqual(DEFAULT_ADMIN_USERS, ["@antoniotsd", "@Cuervo0o0o", "@talhapervaiz97"]);
  assert.equal(isAdminTelegramUser({ id: 999, username: "antoniotsd" }), true);
  assert.equal(isAdminTelegramUser({ id: 1000, username: "Cuervo0o0o" }), true);
  assert.equal(isAdminTelegramUser({ id: 1001, username: "talhapervaiz97" }), true);
});

test("settings access is limited to @antoniotsd", () => {
  assert.equal(SETTINGS_ADMIN_USER, "@antoniotsd");
  assert.equal(isSettingsAdminTelegramUser({ username: "antoniotsd" }), true);
  assert.equal(isSettingsAdminTelegramUser({ username: "Cuervo0o0o" }), false);
});

test("admin username is allowed and receives admin role", () => {
  const user = { id: 999, username: "AntonioTSD" };

  assert.equal(isAllowedTelegramUser(user, new Set(), new Set(["antoniotsd"])), true);
  assert.equal(getTelegramUserRole(user, new Set(), new Set(["antoniotsd"])), "admin");
});

test("non-admin allowed user receives user role", () => {
  const user = { id: 123, username: "regular" };

  assert.equal(getTelegramUserRole(user, new Set(["123"]), new Set(["antoniotsd"])), "user");
});

test("runtime-approved users are allowed until memory resets", () => {
  clearRuntimeApprovals();
  const user = { id: 777, username: "newuser" };

  assert.equal(isAllowedTelegramUser(user, new Set(), new Set()), false);
  approveTelegramUser(user);
  assert.equal(isAllowedTelegramUser(user, new Set(), new Set()), true);
  assert.equal(getTelegramUserRole(user, new Set(), new Set()), "user");
  assert.equal(listRuntimeApprovals().includes("777"), true);
  clearRuntimeApprovals();
});
