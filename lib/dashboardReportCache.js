import crypto from "node:crypto";

import { isPersistenceEnabled, storeGet, storeSet } from "./store.js";

const memoryCache = new Map();
const MAX_MEMORY_ENTRIES = 80;
const KV_PREFIX = "crm:dash:rpt:";

function ttlMs(env = process.env) {
  const raw = Number(env.DASHBOARD_REPORT_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return 600_000;
}

function cacheEnabled(env = process.env) {
  const flag = String(env.DASHBOARD_REPORT_CACHE || "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(flag);
}

function stableQueryString(query = {}) {
  const entries = Object.entries(query || {})
    .filter(([, value]) => String(value || "").trim())
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

function scopeSignature(accessContext = {}) {
  if (accessContext?.authorityScope?.unrestricted) {
    return "all";
  }
  return JSON.stringify(accessContext?.permissionFilters || {});
}

export function dashboardReportCacheKey(accessContext = {}, query = {}) {
  const digest = crypto
    .createHash("sha256")
    .update(`${scopeSignature(accessContext)}|${stableQueryString(query)}`)
    .digest("hex")
    .slice(0, 40);
  return digest;
}

export function shouldUseDashboardReportCache(query = {}) {
  if (!cacheEnabled()) {
    return false;
  }
  const skipKeys = ["monitor", "debugDiagnostics", "benchmarkHydrate"];
  for (const key of skipKeys) {
    const value = String(query?.[key] || "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) {
      return false;
    }
  }
  return true;
}

export async function getCachedDashboardReport(accessContext = {}, query = {}) {
  if (!shouldUseDashboardReportCache(query)) {
    return null;
  }
  const key = dashboardReportCacheKey(accessContext, query);
  const ttl = ttlMs();
  if (ttl <= 0) {
    return null;
  }
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
    return memoryEntry.report;
  }
  if (!isPersistenceEnabled()) {
    return null;
  }
  try {
    const raw = await storeGet(`${KV_PREFIX}${key}`);
    if (!raw) {
      return null;
    }
    const report = JSON.parse(raw);
    memoryCache.set(key, { report, expiresAt: Date.now() + ttl });
    return report;
  } catch (error) {
    console.error("Dashboard report cache read failed", error);
    return null;
  }
}

export async function setCachedDashboardReport(accessContext = {}, query = {}, report = null) {
  if (!report || !shouldUseDashboardReportCache(query)) {
    return;
  }
  const key = dashboardReportCacheKey(accessContext, query);
  const ttl = ttlMs();
  if (ttl <= 0) {
    return;
  }
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, { report, expiresAt: Date.now() + ttl });
  if (!isPersistenceEnabled()) {
    return;
  }
  try {
    const serialized = JSON.stringify(report);
    if (serialized.length > 900_000) {
      return;
    }
    await storeSet(`${KV_PREFIX}${key}`, serialized, Math.ceil(ttl / 1000));
  } catch (error) {
    console.error("Dashboard report cache write failed", error);
  }
}
