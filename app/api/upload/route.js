import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { dashboardAccessFromRequest } from "../../../lib/dashboardRequest.js";
import { rowsToObjects } from "../../../lib/googleSheets.js";
import { saveSource } from "../../../lib/leadsStore.js";
import {
  derivePeriod,
  prepareAuxiliaryRowsForStore,
  prepareRowsForStore,
} from "../../../lib/sheetRowMapper.js";
import { flushPersistence, isPersistenceEnabled } from "../../../lib/store.js";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "crm-upload",
    persistentStoreConfigured: isPersistenceEnabled(),
  });
}

export async function POST(request) {
  // Access is gated by the same Telegram login + admin approval as the
  // dashboard. There is no separate password: an authorized dashboard user can
  // upload, an unauthorized (pending-approval) user cannot.
  const resolved = await dashboardAccessFromRequest(request);
  if (!resolved.authenticated) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!resolved.access?.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ ok: false, error: "unsupported_content_type" }, { status: 415 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form_data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ ok: false, error: "A file is required." }, { status: 400 });
  }

  const tabKey = String(form.get("tabKey") || "leads").trim() || "leads";
  const tabConfig = getTabConfig(tabKey);

  const sourceKey = String(form.get("sourceKey") || "").trim();
  if (!sourceKey) {
    return NextResponse.json({ ok: false, error: "A source key is required." }, { status: 400 });
  }

  const category = String(form.get("category") || (tabKey === "leads" ? "leads" : "")).trim();
  const meta = {
    office: form.get("office") ? String(form.get("office")).trim() : null,
    period: form.get("period") ? String(form.get("period")).trim() : null,
    category: category || null,
    spreadsheetId: null,
    sheetRange: null,
  };

  let values;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ ok: false, error: "The file has no sheets." }, { status: 400 });
    }
    const sheet = workbook.Sheets[sheetName];
    // header: 1 keeps the raw grid (first row = headers), matching how the
    // ingest endpoint accepts `values[][]` from the Google Sheets sync.
    values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `Could not read the file: ${String(error?.message || error).slice(0, 200)}` },
      { status: 400 },
    );
  }

  const rawRows = rowsToObjects(values, tabConfig.columns);

  try {
    const isLeads = category === "leads" || tabKey === "leads";
    const rows = isLeads
      ? prepareRowsForStore(rawRows, tabConfig, meta)
      : prepareAuxiliaryRowsForStore(rawRows, tabConfig, meta);
    if (!meta.period && isLeads && rows.length > 0) {
      const fields = tabConfig.fields || {};
      meta.period = derivePeriod(rows[0][fields.leadDate], rows[0][fields.created]);
    }
    const result = saveSource(sourceKey, meta, rows);
    return NextResponse.json({
      ok: true,
      sourceKey,
      tabKey,
      category: meta.category,
      office: meta.office,
      period: meta.period,
      received: rawRows.length,
      stored: result.rowCount,
      persisted: isPersistenceEnabled(),
    });
  } catch (error) {
    console.error("Upload ingest failed", error);
    return NextResponse.json(
      { ok: false, error: String(error?.message || error).slice(0, 300) },
      { status: 500 },
    );
  } finally {
    await flushPersistence().catch(() => {});
  }
}
