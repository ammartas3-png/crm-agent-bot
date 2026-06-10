import { NextResponse } from "next/server";

import { readAuthorityRows, removeAuthorityRowByNumber, upsertAuthorityUserScope } from "../../../../lib/authoritySheetService.js";
import { clearAuthorityScopeCache } from "../../../../lib/authorityScope.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { isSettingsAdminTelegramUser, normalizePrincipal } from "../../../../lib/permissions.js";

const LIST_SEPARATOR_REGEX = /[,\n\r;|]+/;
const ALL_TOKENS = new Set(["all", "*", "any", "full", "hepsi", "tum", "tumu", "tümü"]);

function parseScopeList(value = "") {
  return String(value || "")
    .split(LIST_SEPARATOR_REGEX)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isAllScope(value = "") {
  return ALL_TOKENS.has(String(value || "").trim().toLocaleLowerCase("en-US"));
}

function normalizedValue(value = "") {
  return normalizePrincipal(String(value || "").trim());
}

function rowMatchesScopeSelection(rawValue = "", selected = "") {
  const selectedValue = normalizedValue(selected);
  if (!selectedValue) {
    return true;
  }
  const list = parseScopeList(rawValue);
  if (!list.length) {
    return true;
  }
  return list.some((item) => isAllScope(item) || normalizedValue(item) === selectedValue);
}

function scopeOptionsFromRows(rows = [], key = "office") {
  const set = new Set();
  for (const row of rows) {
    const values = parseScopeList(row?.[key] || "");
    for (const value of values) {
      if (!isAllScope(value)) {
        set.add(value);
      }
    }
  }
  return [...set].sort((left, right) => left.localeCompare(right));
}

function displayScope(rawValue = "") {
  const values = parseScopeList(rawValue).filter((value) => !isAllScope(value));
  if (!values.length) {
    return "all";
  }
  return values.join(", ");
}

function toPermissionRow(row = {}) {
  const username = String(row.telegramUsername || "").trim();
  return {
    rowNumber: Number(row.rowNumber) || 0,
    userName: String(row.userName || "").trim(),
    telegramUsername: username,
    telegramId: String(row.telegramId || "").trim(),
    authority: String(row.authority || "CRM").trim(),
    office: displayScope(row.office),
    desk: displayScope(row.desk),
    team: displayScope(row.team),
  };
}

function filteredRows(rows = [], filters = {}) {
  const byOffice = rows.filter((row) => rowMatchesScopeSelection(row.office, filters.office));
  const byDesk = byOffice.filter((row) => rowMatchesScopeSelection(row.desk, filters.desk));
  const byTeam = byDesk.filter((row) => rowMatchesScopeSelection(row.team, filters.team));
  return {
    byOffice,
    byDesk,
    filtered: byTeam,
  };
}

function listPayload(rows = [], filters = {}) {
  const { byOffice, byDesk, filtered } = filteredRows(rows, filters);
  return {
    rows: filtered.map(toPermissionRow),
    options: {
      offices: scopeOptionsFromRows(rows, "office"),
      desks: scopeOptionsFromRows(byOffice, "desk"),
      teams: scopeOptionsFromRows(byDesk, "team"),
    },
  };
}

function queryParams(searchParams) {
  return {
    office: String(searchParams.get("office") || "").trim(),
    desk: String(searchParams.get("desk") || "").trim(),
    team: String(searchParams.get("team") || "").trim(),
  };
}

async function requireSettingsAdmin(request) {
  const resolved = await dashboardAccessFromRequest(request);
  if (!resolved.authenticated) {
    return { error: NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 }) };
  }
  if (!resolved.access?.authorized) {
    return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 }) };
  }
  if (!isSettingsAdminTelegramUser(resolved.telegramUser)) {
    return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }
  return { resolved };
}

export async function GET(request) {
  const required = await requireSettingsAdmin(request);
  if (required.error) {
    return required.error;
  }
  try {
    const filters = queryParams(new URL(request.url).searchParams);
    const rows = await readAuthorityRows();
    return NextResponse.json({
      ok: true,
      ...listPayload(rows, filters),
      filters,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "permissions_load_failed",
        message: error?.message || "Could not load permissions.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const required = await requireSettingsAdmin(request);
  if (required.error) {
    return required.error;
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const telegramUsernameRaw = String(payload.telegramUsername || "").trim();
  const telegramUsername = telegramUsernameRaw.replace(/^@+/, "");
  const telegramIdRaw = String(payload.telegramId || "").trim().replace(/\.0+$/, "");
  const telegramId = /^\d+$/.test(telegramIdRaw) ? Number(telegramIdRaw) : 0;
  if (!telegramUsername && !telegramId) {
    return NextResponse.json(
      { ok: false, error: "invalid_user", message: "Provide Telegram username or Telegram ID." },
      { status: 400 },
    );
  }
  try {
    await upsertAuthorityUserScope({
      user: {
        id: telegramId || 0,
        username: telegramUsername,
        first_name: String(payload.userName || "").trim(),
      },
      offices: parseScopeList(payload.office),
      desks: parseScopeList(payload.desk),
      teams: parseScopeList(payload.team),
      authorityRole: String(payload.authority || "crm").trim() || "crm",
    });
    clearAuthorityScopeCache();
    const filters = {
      office: String(payload.filterOffice || "").trim(),
      desk: String(payload.filterDesk || "").trim(),
      team: String(payload.filterTeam || "").trim(),
    };
    const rows = await readAuthorityRows();
    return NextResponse.json({
      ok: true,
      ...listPayload(rows, filters),
      filters,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "permissions_save_failed",
        message: error?.message || "Could not save permission.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request) {
  const required = await requireSettingsAdmin(request);
  if (required.error) {
    return required.error;
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const rowNumber = Number(payload.rowNumber);
  if (!Number.isFinite(rowNumber) || rowNumber < 2) {
    return NextResponse.json(
      { ok: false, error: "invalid_row_number", message: "Valid row number is required." },
      { status: 400 },
    );
  }
  try {
    await removeAuthorityRowByNumber(rowNumber);
    clearAuthorityScopeCache();
    const filters = {
      office: String(payload.filterOffice || "").trim(),
      desk: String(payload.filterDesk || "").trim(),
      team: String(payload.filterTeam || "").trim(),
    };
    const rows = await readAuthorityRows();
    return NextResponse.json({
      ok: true,
      ...listPayload(rows, filters),
      filters,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "permissions_delete_failed",
        message: error?.message || "Could not delete permission.",
      },
      { status: 500 },
    );
  }
}
