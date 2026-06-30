import { NextResponse } from "next/server";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { rowsToObjects } from "../../../lib/googleSheets.js";
import { saveSource } from "../../../lib/leadsStore.js";
import { prepareRowsForStore, derivePeriod } from "../../../lib/sheetRowMapper.js";
import { flushPersistence, isPersistenceEnabled } from "../../../lib/store.js";

export const runtime = "nodejs";

function ingestSecret(env = process.env) {
  return String(env.INGEST_SECRET || "").trim();
}

function providedSecret(request) {
  const header = request.headers.get("x-ingest-secret");
  if (header) {
    return header;
  }
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "crm-ingest",
    ingestSecretConfigured: Boolean(ingestSecret()),
    persistentStoreConfigured: isPersistenceEnabled(),
    persistenceMode: isPersistenceEnabled()
      ? process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
        ? "kv-rest"
        : "redis-url"
      : "memory",
  });
}

export async function POST(request) {
  const secret = ingestSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Ingestion is not configured (set INGEST_SECRET)." },
      { status: 503 },
    );
  }
  if (providedSecret(request) !== secret) {
    return NextResponse.json({ ok: false, error: "Invalid ingest secret" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const sourceKey = String(body.sourceKey || "").trim();
  if (!sourceKey) {
    return NextResponse.json({ ok: false, error: "sourceKey is required" }, { status: 400 });
  }

  const tabConfig = getTabConfig(body.tabKey || "leads");

  // Accept either header-keyed objects (`rows`) or raw sheet `values` arrays.
  let rawRows = [];
  if (Array.isArray(body.rows)) {
    rawRows = body.rows;
  } else if (Array.isArray(body.values)) {
    rawRows = rowsToObjects(body.values, tabConfig.columns);
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide rows[] (objects) or values[][] (raw sheet rows)." },
      { status: 400 },
    );
  }

  const meta = {
    office: body.office ? String(body.office).trim() : null,
    period: body.period ? String(body.period).trim() : null,
    category: body.category ? String(body.category).trim() : null,
    spreadsheetId: body.spreadsheetId || null,
    sheetRange: body.sheetRange || null,
  };

  try {
    const rows = prepareRowsForStore(rawRows, tabConfig, meta);
    if (!meta.period && rows.length > 0) {
      const fields = tabConfig.fields || {};
      meta.period = derivePeriod(rows[0][fields.leadDate], rows[0][fields.created]);
    }
    const result = saveSource(sourceKey, meta, rows);
    return NextResponse.json({
      ok: true,
      sourceKey,
      received: rawRows.length,
      stored: result.rowCount,
      persisted: isPersistenceEnabled(),
    });
  } catch (error) {
    console.error("Ingestion failed", error);
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  } finally {
    await flushPersistence().catch(() => {});
  }
}
