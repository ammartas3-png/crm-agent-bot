import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { dashboardReportWorkbookBuffer } from "../../../../../lib/dashboardWorkbookExporter.js";
import { loadDashboardReport } from "../../../../../lib/dashboardService.js";

export const maxDuration = 300;

const KNOWN_QUERY_KEYS = [
  "monthKey",
  "officeScope",
  "reportMode",
  "specificType",
  "date",
  "hour",
  "desk",
  "country",
  "brand",
  "campaign",
  "subCampaign",
  "placement",
  "status",
  "teamLeader",
  "agent",
  "groupBy",
  "rowDimensions",
  "metricFields",
  "totalDimensions",
  "columnDimension",
  "includeColumnGrandTotal",
  "agentProductivityPlanMode",
  "last4QuickMode",
  "includeWorkTime",
  "hideNotWorking",
  "benchmarkMode",
  "benchmarkHydrate",
  "benchmarkSheetOnly",
  "includeKycFtd",
  "debugDiagnostics",
  "page",
  "rowLimit",
];

function normalizeScalar(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(",");
  }
  if (typeof value === "boolean") {
    return value ? "1" : "";
  }
  return String(value || "").trim();
}

function normalizeQueryPayload(query = {}) {
  const source = query && typeof query === "object" ? query : {};
  const normalized = {};
  for (const key of KNOWN_QUERY_KEYS) {
    normalized[key] = normalizeScalar(source[key]);
  }
  return normalized;
}

function safeName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function workbookFilename(report = {}, query = {}, preferredName = "") {
  const preferred = safeName(preferredName);
  if (preferred) {
    return preferred.toLowerCase().endsWith(".xlsx") ? preferred : `${preferred}.xlsx`;
  }
  const office = safeName(report?.month?.office_name || query.officeScope || "office");
  const month = safeName(report?.month?.key || query.monthKey || "month");
  const mode = safeName(report?.reportMode || "report");
  return `crm-${mode}-${office}-${month}.xlsx`;
}

function timingSafeEqualText(left = "", right = "") {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function n8nAuthFromRequest(request) {
  const expectedSecret = String(process.env.N8N_WORKFLOW_SECRET || "").trim();
  if (!expectedSecret) {
    return {
      ok: false,
      status: 500,
      error: "n8n_secret_not_configured",
      message: "N8N_WORKFLOW_SECRET is not configured.",
    };
  }
  const authorization = String(request.headers.get("authorization") || "");
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = String(request.headers.get("x-n8n-secret") || "").trim();
  const providedSecret = bearerToken || headerToken;
  if (!providedSecret || !timingSafeEqualText(providedSecret, expectedSecret)) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Invalid n8n secret.",
    };
  }
  return { ok: true };
}

function integrationAccessContext() {
  return {
    authorized: true,
    authorityScope: {
      allowed: true,
      unrestricted: true,
      filters: {},
    },
    permissionFilters: {},
    telegramUser: {
      id: 0,
      username: "n8n",
    },
  };
}

async function parseJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export async function GET(request) {
  const auth = n8nAuthFromRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status },
    );
  }
  return NextResponse.json({
    ok: true,
    name: "crm-dashboard-n8n-report",
    formats: ["json", "xlsx"],
    auth: "Bearer or x-n8n-secret",
  });
}

export async function POST(request) {
  const auth = n8nAuthFromRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      { status: auth.status },
    );
  }
  try {
    const body = await parseJsonBody(request);
    const format = String(body.format || "json").trim().toLowerCase();
    if (!["json", "xlsx"].includes(format)) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_format",
          message: "format must be either 'json' or 'xlsx'.",
        },
        { status: 400 },
      );
    }
    const query = normalizeQueryPayload(body.query || body.filters || {});
    const report = await loadDashboardReport(integrationAccessContext(), query);
    if (format === "xlsx") {
      const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
      const filename = workbookFilename(report, query, body.filename);
      return NextResponse.json({
        ok: true,
        format: "xlsx",
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dataBase64: Buffer.from(workbookBuffer).toString("base64"),
        report: {
          reportMode: report?.reportMode || "",
          specificType: report?.specificType || "",
          month: report?.month || null,
          tableType: report?.tableType || "",
          tableTitle: report?.tableTitle || "",
          summary: report?.summary || null,
        },
      });
    }
    return NextResponse.json({
      ok: true,
      format: "json",
      report,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "n8n_report_route_failed",
        message: error?.message || "Could not build report for n8n.",
      },
      { status: 500 },
    );
  }
}
