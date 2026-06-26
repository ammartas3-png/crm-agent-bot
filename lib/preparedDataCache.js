import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CACHE_TTL_MS = 5 * 1000;
const MISSING = Symbol("missing");

let manifestCache = {
  path: "",
  mtimeMs: 0,
  checkedAt: 0,
  value: null,
};
const jsonFileCache = new Map();

function toBoolean(value = "", fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function cacheTtlMs() {
  if (Number.isFinite(Number(process.env.N8N_PREPARED_CACHE_TTL_MS))) {
    return Math.max(0, Number(process.env.N8N_PREPARED_CACHE_TTL_MS));
  }
  return DEFAULT_CACHE_TTL_MS;
}

export function preparedDataCacheEnabled() {
  return toBoolean(process.env.N8N_PREPARED_CACHE_ENABLED, false);
}

export function preparedDataCacheRequired() {
  return toBoolean(process.env.N8N_PREPARED_CACHE_REQUIRED, false);
}

export function preparedDataCacheDir() {
  return String(process.env.N8N_PREPARED_CACHE_DIR || "").trim() || path.join(process.cwd(), ".cache", "n8n-prepared");
}

export function preparedDataManifestPath() {
  const explicit = String(process.env.N8N_PREPARED_CACHE_MANIFEST || "").trim();
  if (explicit) {
    return explicit;
  }
  return path.join(preparedDataCacheDir(), "manifest.json");
}

function safeJsonParse(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readJsonFileCached(filePath = "", options = {}) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return null;
  }
  const allowMissing = Boolean(options.allowMissing);
  const now = Date.now();
  const ttlMs = cacheTtlMs();
  const cached = jsonFileCache.get(normalizedPath);
  if (cached && now - Number(cached.checkedAt || 0) < ttlMs) {
    return cached.value === MISSING ? null : cached.value;
  }
  try {
    const fileStat = await stat(normalizedPath);
    if (cached && Number(cached.mtimeMs || 0) === Number(fileStat.mtimeMs || 0)) {
      cached.checkedAt = now;
      return cached.value === MISSING ? null : cached.value;
    }
    const fileText = await readFile(normalizedPath, "utf8");
    const parsed = safeJsonParse(fileText);
    if (parsed === null) {
      throw new Error(`Invalid JSON in prepared cache file: ${normalizedPath}`);
    }
    jsonFileCache.set(normalizedPath, {
      mtimeMs: Number(fileStat.mtimeMs || 0),
      checkedAt: now,
      value: parsed,
    });
    return parsed;
  } catch (error) {
    if (!allowMissing) {
      throw error;
    }
    jsonFileCache.set(normalizedPath, {
      mtimeMs: 0,
      checkedAt: now,
      value: MISSING,
    });
    return null;
  }
}

export async function readPreparedManifest(options = {}) {
  if (!preparedDataCacheEnabled()) {
    return null;
  }
  const now = Date.now();
  const ttlMs = cacheTtlMs();
  const manifestPath = String(options.manifestPath || preparedDataManifestPath()).trim();
  if (manifestCache.value && manifestCache.path === manifestPath && now - Number(manifestCache.checkedAt || 0) < ttlMs) {
    return manifestCache.value;
  }
  try {
    const manifestStat = await stat(manifestPath);
    if (
      manifestCache.value &&
      manifestCache.path === manifestPath &&
      Number(manifestCache.mtimeMs || 0) === Number(manifestStat.mtimeMs || 0)
    ) {
      manifestCache.checkedAt = now;
      return manifestCache.value;
    }
    const manifestText = await readFile(manifestPath, "utf8");
    const parsed = safeJsonParse(manifestText);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Prepared cache manifest is invalid: ${manifestPath}`);
    }
    manifestCache = {
      path: manifestPath,
      mtimeMs: Number(manifestStat.mtimeMs || 0),
      checkedAt: now,
      value: parsed,
    };
    return parsed;
  } catch {
    manifestCache = {
      path: manifestPath,
      mtimeMs: 0,
      checkedAt: now,
      value: null,
    };
    return null;
  }
}

function toLookupMap(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function resolveSpreadsheetEntry(manifest = {}, spreadsheetId = "") {
  const sheets = manifest?.sheets;
  if (!sheets || typeof sheets !== "object") {
    return {};
  }
  const direct = sheets[spreadsheetId];
  if (direct && typeof direct === "object") {
    return direct;
  }
  const normalizedId = String(spreadsheetId || "").trim().toLowerCase();
  const matchedKey = Object.keys(sheets).find((key) => String(key || "").trim().toLowerCase() === normalizedId);
  return matchedKey ? sheets[matchedKey] || {} : {};
}

function resolveFromRef(ref, rootDir, fallbackDir = "") {
  if (!ref) {
    return null;
  }
  if (Array.isArray(ref)) {
    return ref;
  }
  if (typeof ref === "object") {
    if (Array.isArray(ref.rows)) {
      return ref.rows;
    }
    if (Array.isArray(ref.data)) {
      return ref.data;
    }
    return null;
  }
  if (typeof ref !== "string") {
    return null;
  }
  const rawPath = String(ref || "").trim();
  if (!rawPath) {
    return null;
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  if (fallbackDir) {
    return path.join(fallbackDir, rawPath);
  }
  return path.join(rootDir, rawPath);
}

async function rowsFromManifestRef(ref, rootDir, fallbackDir = "", options = {}) {
  const allowObject = Boolean(options.allowObject);
  const resolved = resolveFromRef(ref, rootDir, fallbackDir);
  if (!resolved) {
    return null;
  }
  if (Array.isArray(resolved)) {
    return resolved;
  }
  const payload = await readJsonFileCached(resolved, { allowMissing: true });
  if (!payload) {
    return null;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (allowObject && payload && typeof payload === "object") {
    return payload;
  }
  return null;
}

export async function readPreparedSheetRows({ spreadsheetId = "", tabKey = "", tabConfig = null, range = "" } = {}) {
  if (!preparedDataCacheEnabled()) {
    return null;
  }
  const normalizedSpreadsheetId = String(spreadsheetId || "").trim();
  if (!normalizedSpreadsheetId) {
    return null;
  }
  const manifest = await readPreparedManifest();
  if (!manifest) {
    return null;
  }
  const rootDir = preparedDataCacheDir();
  const manifestDir = path.dirname(preparedDataManifestPath());
  const sheetEntry = resolveSpreadsheetEntry(manifest, normalizedSpreadsheetId);
  if (!sheetEntry || typeof sheetEntry !== "object") {
    return null;
  }
  const tabKeyLookup = toLookupMap(sheetEntry, ["tabKeys", "tabKey", "tabs"]);
  const tabNameLookup = toLookupMap(sheetEntry, ["tabNames", "tabName"]);
  const rangesLookup = toLookupMap(sheetEntry, ["ranges", "range"]);
  const normalizedTabKey = String(tabKey || "").trim();
  const normalizedRange = String(range || "").trim();
  const normalizedTabName = String(tabConfig?.name || "").trim();
  const candidates = [
    tabKeyLookup[normalizedTabKey],
    tabKeyLookup[normalizedTabKey.toLowerCase()],
    tabNameLookup[normalizedTabName],
    tabNameLookup[normalizedTabName.toLowerCase()],
    rangesLookup[normalizedRange],
  ];
  for (const candidate of candidates) {
    const rows = await rowsFromManifestRef(candidate, rootDir, manifestDir);
    if (Array.isArray(rows)) {
      return rows;
    }
  }
  const flatLookup = manifest?.sheetRows;
  if (flatLookup && typeof flatLookup === "object") {
    const compositeCandidates = [
      `${normalizedSpreadsheetId}::${normalizedTabKey}`,
      `${normalizedSpreadsheetId}::${normalizedTabKey.toLowerCase()}`,
      `${normalizedSpreadsheetId}::${normalizedRange}`,
    ];
    for (const key of compositeCandidates) {
      const rows = await rowsFromManifestRef(flatLookup[key], rootDir, manifestDir);
      if (Array.isArray(rows)) {
        return rows;
      }
    }
  }
  return null;
}

export async function readPreparedOfficeMonthMap() {
  if (!preparedDataCacheEnabled()) {
    return null;
  }
  const manifest = await readPreparedManifest();
  if (!manifest) {
    return null;
  }
  const rootDir = preparedDataCacheDir();
  const manifestDir = path.dirname(preparedDataManifestPath());
  const officeMapRef = manifest.officeMonthMap || manifest.office_map || null;
  const officeMap = await rowsFromManifestRef(officeMapRef, rootDir, manifestDir, { allowObject: true });
  if (officeMap && typeof officeMap === "object" && !Array.isArray(officeMap)) {
    return officeMap;
  }
  if (manifest.officeMonthMap && typeof manifest.officeMonthMap === "object" && !Array.isArray(manifest.officeMonthMap)) {
    return manifest.officeMonthMap;
  }
  if (manifest.office_map && typeof manifest.office_map === "object" && !Array.isArray(manifest.office_map)) {
    return manifest.office_map;
  }
  return null;
}

export function clearPreparedDataCache() {
  manifestCache = {
    path: "",
    mtimeMs: 0,
    checkedAt: 0,
    value: null,
  };
  jsonFileCache.clear();
}
