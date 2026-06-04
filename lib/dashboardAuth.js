import crypto from "node:crypto";

const DASHBOARD_SESSION_COOKIE = "crm_dashboard_session";
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const TELEGRAM_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24;

function safeBase64UrlEncode(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64url");
}

function safeBase64UrlDecode(value) {
  try {
    return Buffer.from(String(value || ""), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeHashCompare(left = "", right = "") {
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (!leftText || !rightText || leftText.length !== rightText.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(leftText), Buffer.from(rightText));
}

function getSessionSecret() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for dashboard authentication.");
  }
  return token;
}

export function dashboardSessionCookieName() {
  return DASHBOARD_SESSION_COOKIE;
}

export function createDashboardSessionToken(user = {}) {
  const payload = {
    id: Number(user.id) || 0,
    username: String(user.username || "").trim(),
    first_name: String(user.first_name || "").trim(),
    last_name: String(user.last_name || "").trim(),
    auth_date: Number(user.auth_date) || Math.floor(Date.now() / 1000),
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadRaw = JSON.stringify(payload);
  const payloadEncoded = safeBase64UrlEncode(payloadRaw);
  const signature = hmacHex(getSessionSecret(), payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifyDashboardSessionToken(token = "") {
  const [payloadEncoded = "", signature = ""] = String(token || "").split(".");
  if (!payloadEncoded || !signature) {
    return null;
  }
  let expected = "";
  try {
    expected = hmacHex(getSessionSecret(), payloadEncoded);
  } catch {
    return null;
  }
  if (!safeHashCompare(signature, expected)) {
    return null;
  }
  const payloadText = safeBase64UrlDecode(payloadEncoded);
  if (!payloadText) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || !payload.id) {
    return null;
  }
  const issuedAt = Number(payload.iat) || 0;
  const now = Math.floor(Date.now() / 1000);
  if (!issuedAt || now - issuedAt > DASHBOARD_SESSION_MAX_AGE_SECONDS) {
    return null;
  }
  return payload;
}

export function dashboardSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  };
}

function normalizeTelegramAuthPayload(payload = {}) {
  const result = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value === undefined || value === null) {
      continue;
    }
    result[key] = String(value);
  }
  return result;
}

export function verifyTelegramLoginPayload(payload = {}) {
  const normalized = normalizeTelegramAuthPayload(payload);
  const hash = normalized.hash || "";
  if (!hash) {
    return { ok: false, reason: "missing_hash" };
  }
  const authDate = Number(normalized.auth_date || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: "invalid_auth_date" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
    return { ok: false, reason: "expired_auth_date" };
  }
  const dataCheckString = Object.entries(normalized)
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  let token = "";
  try {
    token = getSessionSecret();
  } catch {
    return { ok: false, reason: "missing_bot_token" };
  }
  const secretKey = crypto.createHash("sha256").update(token).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!safeHashCompare(hash, expectedHash)) {
    return { ok: false, reason: "invalid_hash" };
  }
  return {
    ok: true,
    user: {
      id: Number(normalized.id || 0),
      username: String(normalized.username || "").trim(),
      first_name: String(normalized.first_name || "").trim(),
      last_name: String(normalized.last_name || "").trim(),
      auth_date: authDate,
    },
  };
}
