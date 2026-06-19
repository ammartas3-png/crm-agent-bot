// Pure helpers for the dashboard details page "linked tables" feature.
//
// The details page shows three coordinated tables — Daily Trend, Leads Sheet
// Fields, and Traffic Report — that are each aggregated by DIFFERENT dimensions
// from the same scoped dataset. Selecting a row in one filters the others.
//
// The critical rule lives in `applyLinkedFiltersToReport`: a selected filter key
// is only enforced on a table that actually has that key as a column/dimension.
// Keys a table is not aggregated by are ignored, so (for example) selecting a
// country in the Traffic Report never blanks out the Daily Trend table, which
// has no country dimension. This module is framework-free so it can be unit
// tested directly.

export function filterValueText(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeDateValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const token = text.split(/[ T]/)[0] || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    return token;
  }
  let matched = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (matched) {
    const day = String(Number(matched[1] || 0)).padStart(2, "0");
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const year = String(Number(matched[3] || 0));
    return `${year}-${month}-${day}`;
  }
  matched = token.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (matched) {
    const year = String(Number(matched[1] || 0));
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const day = String(Number(matched[3] || 0)).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  matched = token.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (matched) {
    const day = String(Number(matched[1] || 0)).padStart(2, "0");
    const month = String(Number(matched[2] || 0)).padStart(2, "0");
    const year = String(Number(matched[3] || 0));
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return "";
}

export function normalizeHourValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const matched = text.match(/^(\d{1,2})(?::\d{2})?/);
  if (!matched) {
    return "";
  }
  const hour = Number(matched[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return "";
  }
  return String(hour).padStart(2, "0");
}

export function createdDatePart(value = "") {
  return normalizeDateValue(value);
}

export function createdHourPart(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const matched = text.match(/\b(\d{2}):\d{2}(?::\d{2})?\b/);
  return matched ? matched[1] : "";
}

export function rowMatchesLinkedFilters(row = {}, linkedFilters = {}) {
  const entries = Object.entries(linkedFilters || {});
  if (!entries.length) {
    return true;
  }
  return entries.every(([key, values]) => {
    const expectedValues = (Array.isArray(values) ? values : [values])
      .map((value) => {
        if (key === "date") {
          return normalizeDateValue(value);
        }
        if (key === "hour") {
          return normalizeHourValue(value);
        }
        return filterValueText(value);
      })
      .filter(Boolean);
    if (!expectedValues.length) {
      return true;
    }
    const candidateValues = new Set();
    const direct =
      key === "date" ? normalizeDateValue(row?.[key]) : key === "hour" ? normalizeHourValue(row?.[key]) : filterValueText(row?.[key]);
    if (direct) {
      candidateValues.add(direct);
    }
    if (key === "date") {
      const createdDate = filterValueText(createdDatePart(row?.created));
      if (createdDate) {
        candidateValues.add(createdDate);
      }
    }
    if (key === "hour") {
      const createdHour = normalizeHourValue(createdHourPart(row?.created));
      if (createdHour) {
        candidateValues.add(createdHour);
      }
    }
    if (!candidateValues.size) {
      return false;
    }
    return expectedValues.some((expected) => candidateValues.has(expected));
  });
}

// Returns the subset of `linkedFilters` whose keys are columns of this report.
export function relevantLinkedFilters(report = null, linkedFilters = {}) {
  const columnKeys = new Set(
    (Array.isArray(report?.builder?.columns) ? report.builder.columns : [])
      .map((column) => String(column?.key || "").trim())
      .filter(Boolean),
  );
  const effective = {};
  for (const [key, values] of Object.entries(linkedFilters || {})) {
    if (columnKeys.has(key)) {
      effective[key] = values;
    }
  }
  return effective;
}

export function applyLinkedFiltersToReport(report = null, linkedFilters = {}) {
  if (!report || !Array.isArray(report?.table)) {
    return report;
  }
  if (!Object.keys(linkedFilters || {}).length) {
    return report;
  }
  // Only enforce filter keys that are actual columns/dimensions of THIS table.
  // The three coordinated tables are aggregated by different dimensions, so a
  // selection like country=DE must not blank out a table (e.g. Daily Trend)
  // that has no country dimension — those keys are simply ignored here.
  const effectiveFilters = relevantLinkedFilters(report, linkedFilters);
  if (!Object.keys(effectiveFilters).length) {
    return report;
  }
  const totalRows = report.table.filter((row) => row?.__rowKind === "total");
  const detailRows = report.table.filter((row) => row?.__rowKind !== "total");
  const filteredRows = detailRows.filter((row) => rowMatchesLinkedFilters(row, effectiveFilters));
  return {
    ...report,
    table: [...filteredRows, ...totalRows],
  };
}
