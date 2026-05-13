import assert from "node:assert/strict";
import test from "node:test";

import { debugKeyStatus } from "../lib/debugKey.js";

test("debugKeyStatus returns only safe boolean key checks", () => {
  const payload = debugKeyStatus({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  });

  assert.deepEqual(payload, {
    hasEmail: true,
    hasKey: true,
    startsWithBegin: true,
    endsWithEnd: true,
    containsRealNewlines: true,
  });
  assert.equal(Object.keys(payload).length, 5);
});
