import assert from "node:assert/strict";
import test from "node:test";

import { getGoogleCredentialConfig, normalizePrivateKey } from "../lib/googleSheets.js";

const RAW_KEY = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
const NORMALIZED_KEY = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n";

test("normalizePrivateKey converts escaped newlines", () => {
  assert.equal(normalizePrivateKey(RAW_KEY), NORMALIZED_KEY);
});

test("getGoogleCredentialConfig reads GOOGLE_PRIVATE_KEY", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GOOGLE_PRIVATE_KEY: RAW_KEY,
  });

  assert.equal(config.email, "svc@example.com");
  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_PRIVATE_KEY");
});

test("getGoogleCredentialConfig reads base64 private key", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GOOGLE_PRIVATE_KEY_BASE64: Buffer.from(RAW_KEY, "utf8").toString("base64"),
  });

  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_PRIVATE_KEY_BASE64");
});

test("getGoogleCredentialConfig reads service account JSON", () => {
  const config = getGoogleCredentialConfig({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "json@example.com",
      private_key: RAW_KEY,
    }),
  });

  assert.equal(config.email, "json@example.com");
  assert.equal(config.privateKey, NORMALIZED_KEY);
  assert.equal(config.privateKeySource, "GOOGLE_SERVICE_ACCOUNT_JSON");
});
