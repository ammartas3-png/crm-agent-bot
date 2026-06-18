import crypto from "node:crypto";

function serializeLogValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function dashboardPerfLog(event, fields = {}) {
  const payload = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${serializeLogValue(value)}`)
    .join(" ");
  if (payload) {
    console.log(`[${event}] ${payload}`);
    return;
  }
  console.log(`[${event}]`);
}

export function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function hashStableValue(value) {
  const serialized = JSON.stringify(stableValue(value));
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function safeCacheKeyPart(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "all";
}

export function isGoogle429Error(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("quota")
  );
}

export function isGoogleTimeoutError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "report_timeout" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("deadline exceeded") ||
    message.includes("function_invocation_timeout")
  );
}

export function isGoogleLoadingError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("loading google sheets") || message.includes("google sheet") || message.includes("sheets");
}

export function shouldUseStaleReport(error) {
  return isGoogle429Error(error) || isGoogleTimeoutError(error) || isGoogleLoadingError(error);
}
