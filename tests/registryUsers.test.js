import assert from "node:assert/strict";
import test from "node:test";

import { clearRegistryAllowedUsers, isAllowedTelegramUser } from "../lib/permissions.js";
import {
  isRegistryAuthEnabled,
  refreshRegistryUsers,
  resetRegistryUsersCache,
} from "../lib/registryUsers.js";

test("isRegistryAuthEnabled reads the opt-in flag", () => {
  assert.equal(isRegistryAuthEnabled({}), false);
  assert.equal(isRegistryAuthEnabled({ AUTHORIZE_FROM_REGISTRY: "true" }), true);
  assert.equal(isRegistryAuthEnabled({ AUTHORIZE_FROM_REGISTRY: "1" }), true);
  assert.equal(isRegistryAuthEnabled({ AUTHORIZE_FROM_REGISTRY: "no" }), false);
});

test("refreshRegistryUsers loads the users tab and authorizes them", async () => {
  resetRegistryUsersCache();
  clearRegistryAllowedUsers();

  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [["Username"], ["@officeboss"], ["555"]] } }),
      },
    },
  };
  const authorityConfig = { spreadsheetId: "auth-id", usersRange: "'users'!A:Z" };

  const result = await refreshRegistryUsers({ force: true, sheetsClient, authorityConfig });
  assert.equal(result.count, 2);
  assert.equal(isAllowedTelegramUser({ id: 1, username: "OfficeBoss" }, new Set(), new Set()), true);
  assert.equal(isAllowedTelegramUser(555, new Set(), new Set()), true);

  // Within the TTL a non-forced refresh is skipped.
  const skipped = await refreshRegistryUsers({ sheetsClient, authorityConfig });
  assert.equal(skipped.skipped, true);

  clearRegistryAllowedUsers();
  resetRegistryUsersCache();
});
