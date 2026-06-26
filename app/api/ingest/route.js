import { NextResponse } from "next/server";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { isDatabaseEnabled } from "../../../lib/db.js";
import { rowsToObjects } from "../../../lib/googleSheets.js";
import { replaceSourceRows } from "../../../lib/leadsRepository.js";
import { mapSheetRowsToRecords } from "../../../lib/sheetRowMapper.js";
import { flushPersistence } from "../../../lib/store.js";

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
    databaseEnabled: isDatabaseEnabled(),
    ingestSecretConfigured: Boolean(ingestSecret()),
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
  if (!isDatabaseEnabled()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
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
  let rows = [];
  if (Array.isArray(body.rows)) {
    rows = body.rows;
  } else if (Array.isArray(body.values)) {
    rows = rowsToObjects(body.values, tabConfig.columns);
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide rows[] (objects) or values[][] (raw sheet rows)." },
      { status: 400 },
    );
  }

  const meta = {
    sourceKey,
    office: body.office ? String(body.office).trim() : null,
    period: body.period ? String(body.period).trim() : null,
    category: body.category ? String(body.category).trim() : null,
    spreadsheetId: body.spreadsheetId || null,
    sheetRange: body.sheetRange || null,
  };

  try {
    const records = mapSheetRowsToRecords(rows, tabConfig, meta);
    const result = await replaceSourceRows(sourceKey, meta, records);
    return NextResponse.json({
      ok: true,
      sourceKey,
      received: rows.length,
      stored: result.rowCount,
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
