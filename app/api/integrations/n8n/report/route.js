import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { dashboardReportWorkbookBuffer } from "../../../../../lib/dashboardWorkbookExporter.js";
import { dashboardBootstrap, loadDashboardReport } from "../../../../../lib/dashboardService.js";

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
const MAX_N8N_BATCH_EXPORTS = Math.max(1, Number(process.env.N8N_BATCH_MAX_EXPORTS || 48));

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

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || "").split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStringList(values = []) {
  return [...new Set(parseStringList(values))];
}

function asEnabled(value = "", fallback = true) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(normalized);
}

function normalizedAction(value = "") {
  const normalized = String(value || "report")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "report";
  }
  return normalized;
}

function isBatchMonthlyAction(action = "") {
  return ["batch_monthly_excel", "batchmonthlyexcel", "batch_monthly", "batch"].includes(String(action || ""));
}

function resolveBatchTargets(body = {}, bootstrap = {}, baseQuery = {}) {
  const bodyOffices = uniqueStringList(body.officeScopes);
  const bodyMonths = uniqueStringList(body.monthKeys);
  const queryOffices = uniqueStringList(baseQuery.officeScope);
  const queryMonths = uniqueStringList(baseQuery.monthKey);
  const fallbackOffices = Array.isArray(bootstrap?.officeScopes) ? bootstrap.officeScopes : [];
  const fallbackMonths = Array.isArray(bootstrap?.months)
    ? bootstrap.months.map((item) => String(item?.key || "").trim()).filter(Boolean)
    : [];
  const officeScopes = bodyOffices.length ? bodyOffices : queryOffices.length ? queryOffices : fallbackOffices;
  const monthKeys = bodyMonths.length ? bodyMonths : queryMonths.length ? queryMonths : fallbackMonths;
  if (!officeScopes.length || !monthKeys.length) {
    return [];
  }
  const targets = [];
  for (const officeScope of officeScopes) {
    for (const monthKey of monthKeys) {
      targets.push({
        officeScope: String(officeScope || "").trim(),
        monthKey: String(monthKey || "").trim(),
      });
    }
  }
  return targets.filter((item) => item.officeScope && item.monthKey);
}

async function runWithConcurrency(items = [], worker, concurrency = 2) {
  const list = Array.isArray(items) ? items : [];
  const safeConcurrency = Math.max(1, Math.min(Number(concurrency || 1), 6));
  const output = new Array(list.length);
  let cursor = 0;
  async function next() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) {
        return;
      }
      output[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(safeConcurrency, list.length || 1) }, () => next()));
  return output;
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
    actions: ["report", "bootstrap", "batch_monthly_excel"],
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
    const action = normalizedAction(body.action);
    const accessContext = integrationAccessContext();
    if (action === "bootstrap") {
      const bootstrap = await dashboardBootstrap(accessContext);
      return NextResponse.json({
        ok: true,
        action: "bootstrap",
        bootstrap,
      });
    }

    if (isBatchMonthlyAction(action)) {
      const bootstrap = await dashboardBootstrap(accessContext);
      const baseQuery = normalizeQueryPayload(body.query || body.filters || {});
      const targets = resolveBatchTargets(body, bootstrap, baseQuery);
      if (!targets.length) {
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_batch_targets",
            message: "Provide officeScopes/monthKeys or query.officeScope/query.monthKey.",
          },
          { status: 400 },
        );
      }
      if (targets.length > MAX_N8N_BATCH_EXPORTS) {
        return NextResponse.json(
          {
            ok: false,
            error: "batch_limit_exceeded",
            message: `Maximum ${MAX_N8N_BATCH_EXPORTS} monthly exports per request.`,
            totalTargets: targets.length,
          },
          { status: 422 },
        );
      }
      const includeBase64 = asEnabled(body.includeBase64, true);
      const requestedConcurrency = Number.parseInt(String(body.concurrency || "2"), 10);
      const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 2;
      const startedAt = Date.now();
      let successCount = 0;
      let failureCount = 0;
      const results = await runWithConcurrency(
        targets,
        async (target) => {
          const query = normalizeQueryPayload({
            ...baseQuery,
            officeScope: target.officeScope,
            monthKey: target.monthKey,
          });
          try {
            const report = await loadDashboardReport(accessContext, query);
            const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
            const filename = workbookFilename(report, query, body.filenamePrefix ? `${body.filenamePrefix}-${target.monthKey}` : "");
            const payload = {
              ok: true,
              officeScope: target.officeScope,
              monthKey: target.monthKey,
              filename,
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              sizeBytes: Number(workbookBuffer?.byteLength || 0),
              report: {
                reportMode: report?.reportMode || "",
                specificType: report?.specificType || "",
                month: report?.month || null,
                summary: report?.summary || null,
              },
            };
            if (includeBase64) {
              payload.dataBase64 = Buffer.from(workbookBuffer).toString("base64");
            }
            successCount += 1;
            return payload;
          } catch (error) {
            failureCount += 1;
            return {
              ok: false,
              officeScope: target.officeScope,
              monthKey: target.monthKey,
              error: "batch_item_failed",
              message: error?.message || "Could not export monthly workbook.",
            };
          }
        },
        concurrency,
      );
      return NextResponse.json({
        ok: true,
        action: "batch_monthly_excel",
        totalTargets: targets.length,
        successCount,
        failureCount,
        elapsedMs: Date.now() - startedAt,
        includeBase64,
        results,
      });
    }

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
    const report = await loadDashboardReport(accessContext, query);
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
