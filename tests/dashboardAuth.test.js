import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createDashboardSessionToken,
  verifyDashboardSessionToken,
  verifyTelegramLoginPayload,
} from "../lib/dashboardAuth.js";

function withBotToken(token, fn) {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = token;
  try {
    return fn();
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = previous;
  }
}

test("dashboard session token round-trip", () =>
  withBotToken("test-token-123", () => {
    const token = createDashboardSessionToken({
      id: 1240141730,
      username: "antoniotsd",
      first_name: "Antonio",
      auth_date: Math.floor(Date.now() / 1000),
    });
    const payload = verifyDashboardSessionToken(token);
    assert.equal(payload.id, 1240141730);
    assert.equal(payload.username, "antoniotsd");
  }));

test("telegram login payload verification", () =>
  withBotToken("telegram-token", () => {
    const payload = {
      id: "1240141730",
      first_name: "Antonio",
      username: "antoniotsd",
      auth_date: String(Math.floor(Date.now() / 1000)),
    };
    const dataCheckString = Object.entries(payload)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = crypto.createHash("sha256").update("telegram-token").digest();
    const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
    const result = verifyTelegramLoginPayload({
      ...payload,
      hash,
    });
    assert.equal(result.ok, true);
    assert.equal(result.user.username, "antoniotsd");
  }));
