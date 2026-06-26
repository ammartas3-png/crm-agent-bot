import crypto from "node:crypto";

function isoNow() {
  return new Date().toISOString();
}

function alertWebhookUrl() {
  return String(process.env.ALERT_WEBHOOK_URL || process.env.OPS_ALERT_WEBHOOK_URL || "").trim();
}

export function createRequestId(prefix = "req") {
  const random = crypto.randomBytes(6).toString("hex");
  return `${prefix}-${Date.now()}-${random}`;
}

export function logEvent(level = "info", event = "app_event", payload = {}) {
  const entry = {
    ts: isoNow(),
    level: String(level || "info"),
    event: String(event || "app_event"),
    ...payload,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export async function notifyAlert(event = "app_alert", payload = {}) {
  const webhookUrl = alertWebhookUrl();
  if (!webhookUrl) {
    return false;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ts: isoNow(),
        event,
        ...payload,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function logAndAlertError(event = "app_error", payload = {}) {
  logEvent("error", event, payload);
  await notifyAlert(event, payload);
}
