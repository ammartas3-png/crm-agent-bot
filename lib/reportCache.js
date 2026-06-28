import { isPersistenceEnabled, storeGet, storeSet, storeSetAdd, storeSetMembers } from "./store.js";

// Stores small, precomputed dashboard JSONs (one per source = office x month) in
// Redis/KV plus an in-memory mirror. Raw sheet rows are NOT stored (too large
// for KV); only the compact computed report is kept, which is durable and
// scales to many sources.

const PREFIX = "crm:report:";
const INDEX_KEY = "crm:report:index";

const memReports = new Map();
const memIndex = new Map(); // sourceKey -> { office, period }

function reportKey(sourceKey) {
  return `${PREFIX}${sourceKey}`;
}

function normOffice(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

export function clearReportCache() {
  memReports.clear();
  memIndex.clear();
}

export function saveReport(sourceKey, meta = {}, dashboard = {}) {
  const entry = {
    sourceKey,
    office: meta.office || null,
    period: meta.period || null,
    updatedAt: Date.now(),
    dashboard,
  };
  memReports.set(sourceKey, entry);
  memIndex.set(sourceKey, { office: entry.office, period: entry.period });
  storeSet(reportKey(sourceKey), JSON.stringify(entry));
  storeSetAdd(
    INDEX_KEY,
    JSON.stringify({ sourceKey, office: entry.office, period: entry.period }),
  );
  return entry;
}

export async function getReport(sourceKey) {
  if (memReports.has(sourceKey)) {
    return memReports.get(sourceKey);
  }
  if (isPersistenceEnabled()) {
    const raw = await storeGet(reportKey(sourceKey));
    if (raw) {
      try {
        const entry = JSON.parse(raw);
        memReports.set(sourceKey, entry);
        memIndex.set(sourceKey, { office: entry.office, period: entry.period });
        return entry;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function listIndex() {
  const map = new Map(memIndex);
  if (isPersistenceEnabled()) {
    const members = await storeSetMembers(INDEX_KEY);
    for (const member of members) {
      try {
        const parsed = JSON.parse(member);
        if (parsed?.sourceKey && !map.has(parsed.sourceKey)) {
          map.set(parsed.sourceKey, { office: parsed.office, period: parsed.period });
        }
      } catch {
        // ignore malformed index members
      }
    }
  }
  return [...map.entries()].map(([sourceKey, value]) => ({ sourceKey, ...value }));
}

// Returns the cached report entries matching an optional office/period filter.
export async function getReportsBy(filter = {}) {
  const index = await listIndex();
  const matched = index.filter((entry) => {
    if (filter.office && normOffice(entry.office) !== normOffice(filter.office)) {
      return false;
    }
    if (filter.period && entry.period !== filter.period) {
      return false;
    }
    if (Array.isArray(filter.periods) && filter.periods.length > 0) {
      if (!filter.periods.includes(entry.period)) {
        return false;
      }
    }
    return true;
  });
  const reports = [];
  for (const entry of matched) {
    const report = await getReport(entry.sourceKey);
    if (report) {
      reports.push(report);
    }
  }
  return reports;
}
