import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ADMIN_USERS,
  getTelegramUserRole,
  isAdminTelegramUser,
  isAllowedTelegramUser,
  parseAdminUsers,
  parseAllowedUsers,
} from "../lib/permissions.js";

test("parseAllowedUsers reads comma-separated Telegram IDs", () => {
  const users = parseAllowedUsers("123, 456,789");

  assert.equal(users.has("123"), true);
  assert.equal(users.has("456"), true);
  assert.equal(users.has("789"), true);
});

test("parseAdminUsers normalizes usernames with @ prefix", () => {
  const users = parseAdminUsers("@antoniotsd, OtherAdmin");

  assert.equal(users.has("antoniotsd"), true);
  assert.equal(users.has("otheradmin"), true);
});

test("isAllowedTelegramUser denies empty config by default", () => {
  assert.equal(isAllowedTelegramUser(123, new Set(), new Set()), false);
});

test("isAllowedTelegramUser compares IDs as strings", () => {
  assert.equal(isAllowedTelegramUser(123, new Set(["123"]), new Set()), true);
  assert.equal(isAllowedTelegramUser(999, new Set(["123"]), new Set()), false);
});

test("default admin users include antoniotsd", () => {
  assert.deepEqual(DEFAULT_ADMIN_USERS, ["@antoniotsd"]);
  assert.equal(isAdminTelegramUser({ id: 999, username: "antoniotsd" }), true);
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
