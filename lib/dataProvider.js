import { withCache } from "./cache.js";
import { isDatabaseEnabled } from "./db.js";
import { readSheetRows } from "./googleSheets.js";
import { fetchLeadRows, listDistinctValues } from "./leadsRepository.js";
import { getFieldName, uniqueValues } from "./calculations.js";

function cacheTtlSeconds(env = process.env) {
  const raw = Number(env.DATA_CACHE_TTL_SECONDS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return 60;
}

function scopeCacheKey(tabKey, scope = {}) {
  return `rows:${tabKey}:${JSON.stringify({
    dateStart: scope.dateStart || null,
    dateEnd: scope.dateEnd || null,
    sourceKeys: scope.sourceKeys || null,
  })}`;
}

// Translates a bot date filter ({ type: today|month|range }) into a coarse
// [start, end] used only to narrow the SQL fetch. The exact filtering still runs
// in Node, so this just has to be a safe superset.
export function dateFilterToRange(dateFilter, now = new Date()) {
  if (!dateFilter) {
    return {};
  }
  if (dateFilter.type === "today") {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const iso = day.toISOString().slice(0, 10);
    return { dateStart: iso, dateEnd: iso };
  }
  if (dateFilter.type === "month") {
    const year = dateFilter.year ?? now.getUTCFullYear();
    const month = dateFilter.month ?? now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    return { dateStart: start, dateEnd: end };
  }
  if (dateFilter.type === "range") {
    return {
      dateStart: dateFilter.start || null,
      dateEnd: dateFilter.end || null,
    };
  }
  return {};
}

export function scopeFromFilters(filters = {}, now = new Date()) {
  if (!filters.date) {
    return {};
  }
  return dateFilterToRange(filters.date, now);
}

// Unified row loader. Uses Postgres when DATABASE_URL is configured, otherwise
// falls back to the original Google Sheets read. The signature mirrors
// readSheetRows so callers can swap it in transparently.
export async function loadLeadRows(tabKey = "leads", options = {}) {
  if (!isDatabaseEnabled()) {
    return readSheetRows(tabKey, options);
  }

  const scope = options.scope || {};
  const ttl = options.cache === false ? 0 : cacheTtlSeconds();
  return withCache(scopeCacheKey(tabKey, scope), ttl, () => fetchLeadRows(scope));
}

// Lists selectable filter values. With Postgres this uses indexed DISTINCT
// queries (or DISTINCT over the JSON payload) instead of scanning every row.
export async function loadUniqueValues(tabKey, tabConfig, fieldKey, limit = 96, options = {}) {
  if (!isDatabaseEnabled()) {
    const rows = options.rows || (await readSheetRows(tabKey, { tabConfig }));
    return uniqueValues(rows, tabConfig, fieldKey, limit);
  }

  const jsonKey = getFieldName(tabConfig, fieldKey);
  const ttl = options.cache === false ? 0 : cacheTtlSeconds();
  const values = await withCache(`distinct:${tabKey}:${fieldKey}`, ttl, () =>
    listDistinctValues(fieldKey, { jsonKey }),
  );
  return values.slice(0, limit);
}
