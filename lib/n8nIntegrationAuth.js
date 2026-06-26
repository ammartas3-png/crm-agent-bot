import crypto from "node:crypto";

export function timingSafeEqualText(left = "", right = "") {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function n8nAuthFromRequest(request) {
  const expectedSecret = String(process.env.N8N_WORKFLOW_SECRET || "").trim();
  if (!expectedSecret) {
    return {
      ok: false,
      status: 500,
      error: "n8n_secret_not_configured",
      message: "N8N_WORKFLOW_SECRET is not configured.",
    };
  }
  const authorization = String(request.headers.get("authorization") || "");
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = String(request.headers.get("x-n8n-secret") || "").trim();
  const providedSecret = bearerToken || headerToken;
  if (!providedSecret || !timingSafeEqualText(providedSecret, expectedSecret)) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Invalid n8n secret.",
    };
  }
  return { ok: true };
}
