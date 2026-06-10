import { NextResponse } from "next/server";

import { readAuthorityRows } from "../../../../lib/authoritySheetService.js";
import { dashboardAccessFromRequest } from "../../../../lib/dashboardRequest.js";
import { isAdminTelegramUser, normalizePrincipal } from "../../../../lib/permissions.js";

const LIST_SEPARATOR_REGEX = /[,\n\r;|]+/;
const ALL_TOKENS = new Set(["all", "*", "any", "full", "hepsi", "tum", "tumu", "tümü"]);
const AUTO_ALLOWED_FIELDS = ["Agent", "Country", "Campaign", "Sub Campaign", "Placement", "Metrics"];

function parseScopeList(value = "") {
  return String(value || "")
    .split(LIST_SEPARATOR_REGEX)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function isAllScope(value = "") {
  return ALL_TOKENS.has(String(value || "").trim().toLocaleLowerCase("en-US"));
}

function scopeOptionsFromRows(rows = [], key = "office") {
  const set = new Set();
  for (const row of rows) {
    const list = parseScopeList(row?.[key] || "");
    for (const item of list) {
      if (!isAllScope(item)) {
        set.add(item);
      }
    }
  }
  return [...set].sort((left, right) => left.localeCompare(right));
}

function rowMatchesScopeSelection(rawValue = "", selected = "") {
  const normalizedSelected = normalizePrincipal(selected);
  if (!normalizedSelected) {
    return true;
  }
  const list = parseScopeList(rawValue);
  if (!list.length) {
    return true;
  }
  return list.some((item) => {
    if (isAllScope(item)) {
      return true;
    }
    return normalizePrincipal(item) === normalizedSelected;
  });
}

function displayScope(rawValue = "") {
  const list = parseScopeList(rawValue).filter((item) => !isAllScope(item));
  if (!list.length) {
    return "all";
  }
  return list.join(", ");
}

function rowMatchesViewer(row = {}, telegramUser = {}) {
  const principals = new Set(
    [telegramUser?.id, telegramUser?.username, telegramUser?.first_name].map((item) => normalizePrincipal(item)).filter(Boolean),
  );
  if (!principals.size) {
    return false;
  }
  const rowPrincipals = [
    row?.telegramId,
    row?.telegramUsername,
    row?.userName,
  ]
    .map((item) => normalizePrincipal(item))
    .filter(Boolean);
  return rowPrincipals.some((item) => principals.has(item));
}

function queryParams(searchParams) {
  return {
    office: String(searchParams.get("office") || "").trim(),
    desk: String(searchParams.get("desk") || "").trim(),
    team: String(searchParams.get("team") || "").trim(),
  };
}

export async function GET(request) {
  const resolved = await dashboardAccessFromRequest(request);
  if (!resolved.authenticated) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!resolved.access?.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const { office, desk, team } = queryParams(new URL(request.url).searchParams);
  try {
    const authorityRows = await readAuthorityRows();
    const viewerCanSeeAllUsers = isAdminTelegramUser(resolved.telegramUser) || Boolean(resolved.access?.authorityScope?.unrestricted);
    const viewerRows = viewerCanSeeAllUsers
      ? authorityRows
      : authorityRows.filter((row) => rowMatchesViewer(row, resolved.telegramUser));
    const byOffice = viewerRows.filter((row) => rowMatchesScopeSelection(row.office, office));
    const byDesk = byOffice.filter((row) => rowMatchesScopeSelection(row.desk, desk));
    const filteredRows = byDesk.filter((row) => rowMatchesScopeSelection(row.team, team));
    const rows = filteredRows.map((row) => ({
      rowNumber: row.rowNumber,
      user: row.telegramUsername || row.userName || `ID ${row.telegramId}`,
      telegramId: row.telegramId || "",
      authority: row.authority || "CRM",
      office: displayScope(row.office),
      desk: displayScope(row.desk),
      team: displayScope(row.team),
      autoAllowed: AUTO_ALLOWED_FIELDS,
    }));
    return NextResponse.json({
      ok: true,
      viewerCanSeeAllUsers,
      filters: { office, desk, team },
      options: {
        offices: scopeOptionsFromRows(viewerRows, "office"),
        desks: scopeOptionsFromRows(byOffice, "desk"),
        teams: scopeOptionsFromRows(byDesk, "team"),
      },
      rows,
      autoAllowedFields: AUTO_ALLOWED_FIELDS,
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
