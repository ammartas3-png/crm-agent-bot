import { getPool, query, withTransaction } from "./db.js";

const INSERT_CHUNK_SIZE = 500;

const INDEXED_FIELD_COLUMNS = {
  office: "office",
  country: "country",
  period: "period",
};

function dayBoundaries(dateStart, dateEnd) {
  const start = dateStart ? new Date(dateStart) : null;
  const endExclusive = dateEnd ? new Date(dateEnd) : null;
  if (endExclusive) {
    // Make the end inclusive of the whole day by moving to the next midnight.
    endExclusive.setUTCHours(0, 0, 0, 0);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  }
  if (start) {
    start.setUTCHours(0, 0, 0, 0);
  }
  return {
    start: start ? start.toISOString() : null,
    endExclusive: endExclusive ? endExclusive.toISOString() : null,
  };
}

// Builds the WHERE clause. Only the date-range union is pushed to SQL because
// lead and FTD dates are independent: a row whose FTD falls in range but whose
// lead date does not must still be fetched. Every other dimension is filtered
// precisely in Node by the existing calculations, so SQL stays a safe superset.
function buildLeadFilter(scope = {}) {
  const conditions = [];
  const params = [];

  const { start, endExclusive } = dayBoundaries(scope.dateStart, scope.dateEnd);
  if (start || endExclusive) {
    const dateClauses = [];
    for (const column of ["lead_date", "ftd_date"]) {
      const parts = [];
      if (start) {
        params.push(start);
        parts.push(`${column} >= $${params.length}`);
      }
      if (endExclusive) {
        params.push(endExclusive);
        parts.push(`${column} < $${params.length}`);
      }
      dateClauses.push(`(${parts.join(" AND ")})`);
    }
    conditions.push(`(${dateClauses.join(" OR ")})`);
  }

  if (Array.isArray(scope.sourceKeys) && scope.sourceKeys.length > 0) {
    params.push(scope.sourceKeys);
    conditions.push(`source_key = ANY($${params.length})`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function fetchLeadRows(scope = {}, options = {}) {
  const { where, params } = buildLeadFilter(scope);
  const result = await query(
    `SELECT data FROM lead_rows ${where}`,
    params,
    options.client,
  );
  return (result.rows || []).map((row) => row.data);
}

export async function listDistinctValues(fieldKey, options = {}) {
  const column = INDEXED_FIELD_COLUMNS[fieldKey];
  let sql;
  if (column) {
    sql = `SELECT DISTINCT ${column} AS value FROM lead_rows WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY value`;
  } else if (options.jsonKey) {
    // JSON keys come from our own config, never user input, so interpolation is safe.
    const safeKey = String(options.jsonKey).replace(/'/g, "''");
    sql = `SELECT DISTINCT data->>'${safeKey}' AS value FROM lead_rows WHERE NULLIF(btrim(data->>'${safeKey}'), '') IS NOT NULL ORDER BY value`;
  } else {
    return [];
  }
  const result = await query(sql, [], options.client);
  return (result.rows || [])
    .map((row) => String(row.value || "").trim())
    .filter(Boolean);
}

function buildInsertStatement(records, startIndex) {
  const columns = [
    "source_key",
    "office",
    "period",
    "lead_id",
    "country",
    "lead_date",
    "ftd_date",
    "created",
    "data",
  ];
  const valuesSql = [];
  const params = [];
  let placeholder = startIndex;

  for (const record of records) {
    const rowPlaceholders = [
      record.sourceKey,
      record.office,
      record.period,
      record.leadId,
      record.country,
      record.leadDate,
      record.ftdDate,
      record.created,
      JSON.stringify(record.data ?? {}),
    ].map((value, columnIndex) => {
      params.push(value);
      const cast = columns[columnIndex] === "data" ? "::jsonb" : "";
      return `$${placeholder++}${cast}`;
    });
    valuesSql.push(`(${rowPlaceholders.join(", ")})`);
  }

  return {
    sql: `INSERT INTO lead_rows (${columns.join(", ")}) VALUES ${valuesSql.join(", ")}`,
    params,
  };
}

// Re-ingests a single sheet atomically: removes the previous snapshot for the
// source key and inserts the new rows, then updates the source registry. This
// makes repeated n8n syncs idempotent.
export async function replaceSourceRows(sourceKey, meta = {}, records = [], options = {}) {
  if (!sourceKey) {
    throw new Error("replaceSourceRows requires a sourceKey.");
  }

  const run = async (client) => {
    await client.query("DELETE FROM lead_rows WHERE source_key = $1", [sourceKey]);

    for (let index = 0; index < records.length; index += INSERT_CHUNK_SIZE) {
      const chunk = records.slice(index, index + INSERT_CHUNK_SIZE);
      if (chunk.length === 0) {
        continue;
      }
      const { sql, params } = buildInsertStatement(chunk, 1);
      await client.query(sql, params);
    }

    await client.query(
      `INSERT INTO lead_sources (source_key, office, period, category, spreadsheet_id, sheet_range, row_count, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (source_key) DO UPDATE SET
         office = EXCLUDED.office,
         period = EXCLUDED.period,
         category = EXCLUDED.category,
         spreadsheet_id = EXCLUDED.spreadsheet_id,
         sheet_range = EXCLUDED.sheet_range,
         row_count = EXCLUDED.row_count,
         last_synced_at = now()`,
      [
        sourceKey,
        meta.office || null,
        meta.period || null,
        meta.category || null,
        meta.spreadsheetId || null,
        meta.sheetRange || null,
        records.length,
      ],
    );

    return { sourceKey, rowCount: records.length };
  };

  if (options.client) {
    return run(options.client);
  }
  return withTransaction(run);
}

export async function listSources(options = {}) {
  const result = await query(
    "SELECT source_key, office, period, category, row_count, last_synced_at FROM lead_sources ORDER BY period DESC, office, category",
    [],
    options.client,
  );
  return result.rows || [];
}

export async function countLeadRows(options = {}) {
  const result = await query("SELECT count(*)::int AS count FROM lead_rows", [], options.client);
  return result.rows?.[0]?.count ?? 0;
}

export async function ensurePoolReady() {
  // Touch the pool so connection errors surface early in diagnostics.
  return getPool();
}
