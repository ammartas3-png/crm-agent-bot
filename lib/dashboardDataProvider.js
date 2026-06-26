import { getTabConfig, sheetsConfig } from "../config/sheetsConfig.js";
import { readSheetRows as readGoogleSheetRows } from "./googleSheets.js";
import { getOfficeMonthMap as readGoogleOfficeMonthMap } from "./officeMappings.js";
import {
  preparedDataCacheRequired,
  readPreparedOfficeMonthMap,
  readPreparedSheetRows,
} from "./preparedDataCache.js";

const PROVIDER_GOOGLE_SHEETS = "googleSheets";
const PROVIDER_N8N_CACHE = "n8nCache";

const N8N_PROVIDER_ALIASES = new Set(["n8ncache", "n8n_cache", "prepared", "prepared_cache", "n8n"]);

function normalizeProviderName(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return PROVIDER_GOOGLE_SHEETS;
  }
  if (N8N_PROVIDER_ALIASES.has(normalized.toLowerCase())) {
    return PROVIDER_N8N_CACHE;
  }
  return PROVIDER_GOOGLE_SHEETS;
}

function defaultRangeFromTabConfig(tabConfig = {}) {
  return tabConfig.range || `'${String(tabConfig.name || "").trim().replace(/'/g, "''")}'!A:Y`;
}

function resolvedSpreadsheetId(options = {}) {
  return options.spreadsheetId || sheetsConfig.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || "";
}

export function createDashboardDataProvider(options = {}, deps = {}) {
  const providerName = normalizeProviderName(options.provider || process.env.DASHBOARD_DATA_PROVIDER);
  const googleSheetRowsReader = deps.readGoogleSheetRows || readGoogleSheetRows;
  const googleOfficeMapReader = deps.readGoogleOfficeMonthMap || readGoogleOfficeMonthMap;
  const preparedSheetRowsReader = deps.readPreparedSheetRows || readPreparedSheetRows;
  const preparedOfficeMapReader = deps.readPreparedOfficeMonthMap || readPreparedOfficeMonthMap;
  const preparedRequiredResolver = deps.preparedDataCacheRequired || preparedDataCacheRequired;

  async function readSheetRows(tabKey, readOptions = {}) {
    if (providerName === PROVIDER_N8N_CACHE) {
      const tabConfig = readOptions.tabConfig || getTabConfig(tabKey);
      const preparedRows = await preparedSheetRowsReader({
        spreadsheetId: resolvedSpreadsheetId(readOptions),
        tabKey,
        tabConfig,
        range: defaultRangeFromTabConfig(tabConfig),
      });
      if (Array.isArray(preparedRows)) {
        return preparedRows;
      }
      if (preparedRequiredResolver()) {
        throw new Error(
          `Prepared cache miss for ${String(tabKey || "")} (${String(resolvedSpreadsheetId(readOptions) || "")}). ` +
            "N8N_PREPARED_CACHE_REQUIRED is enabled, so Google Sheets fallback is blocked.",
        );
      }
    }
    return googleSheetRowsReader(tabKey, readOptions);
  }

  async function getOfficeMonthMap(readOptions = {}) {
    if (providerName === PROVIDER_N8N_CACHE) {
      const preparedOfficeMap = await preparedOfficeMapReader();
      if (preparedOfficeMap && typeof preparedOfficeMap === "object") {
        return preparedOfficeMap;
      }
      if (preparedRequiredResolver()) {
        throw new Error("Prepared office month map cache is required but not available.");
      }
    }
    return googleOfficeMapReader(readOptions);
  }

  return {
    name: providerName,
    readSheetRows,
    getOfficeMonthMap,
    isN8nCache: providerName === PROVIDER_N8N_CACHE,
  };
}

let cachedProvider = null;
let cachedProviderName = "";

export function getDashboardDataProvider(options = {}) {
  const providerName = normalizeProviderName(options.provider || process.env.DASHBOARD_DATA_PROVIDER);
  if (!cachedProvider || cachedProviderName !== providerName) {
    cachedProvider = createDashboardDataProvider({ ...options, provider: providerName });
    cachedProviderName = providerName;
  }
  return cachedProvider;
}

export function clearDashboardDataProviderCache() {
  cachedProvider = null;
  cachedProviderName = "";
}

export const DASHBOARD_DATA_PROVIDERS = {
  GOOGLE_SHEETS: PROVIDER_GOOGLE_SHEETS,
  N8N_CACHE: PROVIDER_N8N_CACHE,
};
