import { NextResponse } from "next/server";

import { dashboardReportWorkbookBuffer } from "../../../../../lib/dashboardWorkbookExporter.js";
import { dashboardBootstrap, loadDashboardReport } from "../../../../../lib/dashboardService.js";
import { knownDashboardQueryKeys, normalizeDashboardQueryPayload } from "../../../../../lib/dashboardQuery.js";
import { getIdempotentResult, setIdempotentResult } from "../../../../../lib/idempotencyStore.js";
import {
  addBatchArtifact,
  completeBatchJob,
  createBatchJob,
  failBatchJob,
  getBatchJob,
  startBatchJob,
  updateBatchJob,
} from "../../../../../lib/n8nBatchJobs.js";
import { n8nAuthFromRequest } from "../../../../../lib/n8nIntegrationAuth.js";
import { createRequestId, logAndAlertError, logEvent } from "../../../../../lib/opsLogger.js";

export const maxDuration = 300;

const MAX_N8N_BATCH_EXPORTS = Math.max(1, Number(process.env.N8N_BATCH_MAX_EXPORTS || 48));

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

function isBatchMonthlyAsyncAction(action = "") {
  return ["batch_monthly_excel_async", "batch_monthly_async", "batch_async"].includes(String(action || ""));
}

function isBatchJobStatusAction(action = "") {
  return ["batch_job_status", "job_status", "status"].includes(String(action || ""));
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
  } catch (error) {
    const parseError = new Error("Invalid JSON body.");
    parseError.code = "invalid_json";
    parseError.cause = error;
    throw parseError;
  }
}

function buildStatusUrl(request, jobId = "") {
  const baseUrl = new URL(request.url);
  return `${baseUrl.origin}/api/integrations/n8n/report/jobs/${encodeURIComponent(jobId)}`;
}

function buildArtifactUrl(request, jobId = "", artifactId = "") {
  const baseUrl = new URL(request.url);
  return `${baseUrl.origin}/api/integrations/n8n/report/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function batchJobStatusPayload(request, job = null) {
  if (!job) {
    return null;
  }
  return {
    jobId: job.id,
    status: job.status,
    progress: Number(job.progress || 0),
    totalTargets: Number(job.totalTargets || 0),
    successCount: Number(job.successCount || 0),
    failureCount: Number(job.failureCount || 0),
    elapsedMs: Number(job.elapsedMs || 0),
    error: String(job.error || ""),
    statusUrl: buildStatusUrl(request, job.id),
    results: (Array.isArray(job.results) ? job.results : []).map((item) => ({
      ...item,
      artifactUrl:
        item?.jobArtifactId && item?.ok ? buildArtifactUrl(request, job.id, String(item.jobArtifactId || "")) : undefined,
    })),
  };
}

function idempotencyKeyFromRequest(request, body = {}, action = "") {
  const headerKey = String(request.headers.get("x-idempotency-key") || "").trim();
  const bodyKey = String(body.idempotencyKey || "").trim();
  const key = bodyKey || headerKey;
  if (!key) {
    return "";
  }
  return `${String(action || "report")}:${key}`;
}

async function runAsyncBatchJob({
  request,
  jobId,
  targets = [],
  baseQuery = {},
  filenamePrefix = "",
  concurrency = 2,
}) {
  const accessContext = integrationAccessContext();
  const startedAt = Date.now();
  const requestId = createRequestId("n8n-batch-async");
  try {
    startBatchJob(jobId);
    let successCount = 0;
    let failureCount = 0;
    let completed = 0;
    const results = await runWithConcurrency(
      targets,
      async (target) => {
        const query = normalizeDashboardQueryPayload({
          ...baseQuery,
          officeScope: target.officeScope,
          monthKey: target.monthKey,
        });
        try {
          const report = await loadDashboardReport(accessContext, query);
          const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
          const filename = workbookFilename(report, query, filenamePrefix ? `${filenamePrefix}-${target.monthKey}` : "");
          const artifactId = addBatchArtifact(jobId, {
            filename,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            dataBase64: Buffer.from(workbookBuffer).toString("base64"),
          });
          successCount += 1;
          completed += 1;
          updateBatchJob(jobId, (job) => {
            job.successCount = successCount;
            job.failureCount = failureCount;
            job.progress = job.totalTargets > 0 ? Math.round((completed / job.totalTargets) * 100) : 100;
          });
          return {
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
            jobArtifactId: artifactId || "",
          };
        } catch (error) {
          failureCount += 1;
          completed += 1;
          updateBatchJob(jobId, (job) => {
            job.successCount = successCount;
            job.failureCount = failureCount;
            job.progress = job.totalTargets > 0 ? Math.round((completed / job.totalTargets) * 100) : 100;
          });
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
    completeBatchJob(jobId, {
      elapsedMs: Date.now() - startedAt,
      successCount,
      failureCount,
      results,
    });
    logEvent("info", "n8n_batch_async_completed", {
      requestId,
      jobId,
      successCount,
      failureCount,
      totalTargets: targets.length,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    failBatchJob(jobId, error?.message || "Async batch job failed.");
    await logAndAlertError("n8n_batch_async_failed", {
      requestId,
      jobId,
      totalTargets: targets.length,
      elapsedMs: Date.now() - startedAt,
      message: error?.message || "Async batch job failed.",
    });
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
    actions: ["report", "bootstrap", "batch_monthly_excel", "batch_monthly_excel_async", "batch_job_status"],
    formats: ["json", "xlsx"],
    queryKeys: knownDashboardQueryKeys(),
    auth: "Bearer or x-n8n-secret",
  });
}

export async function POST(request) {
  const requestId = createRequestId("n8n-report");
  const startedAt = Date.now();
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
    const idempotencyKey = idempotencyKeyFromRequest(request, body, action);
    if (idempotencyKey) {
      const cached = getIdempotentResult(idempotencyKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }
    const accessContext = integrationAccessContext();
    if (action === "bootstrap") {
      const bootstrap = await dashboardBootstrap(accessContext);
      logEvent("info", "n8n_bootstrap_completed", {
        requestId,
        elapsedMs: Date.now() - startedAt,
      });
      const payload = {
        ok: true,
        action: "bootstrap",
        bootstrap,
      };
      if (idempotencyKey) {
        setIdempotentResult(idempotencyKey, payload);
      }
      return NextResponse.json(payload);
    }

    if (isBatchJobStatusAction(action)) {
      const jobId = String(body.jobId || body.id || "").trim();
      if (!jobId) {
        return NextResponse.json(
          { ok: false, error: "job_id_required", message: "jobId is required for batch job status." },
          { status: 400 },
        );
      }
      const job = getBatchJob(jobId);
      if (!job) {
        return NextResponse.json({ ok: false, error: "job_not_found", message: "Batch job not found." }, { status: 404 });
      }
      const payload = {
        ok: true,
        action: "batch_job_status",
        job: batchJobStatusPayload(request, job),
      };
      return NextResponse.json(payload);
    }

    if (isBatchMonthlyAction(action)) {
      const bootstrap = await dashboardBootstrap(accessContext);
      const baseQuery = normalizeDashboardQueryPayload(body.query || body.filters || {});
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
      const includeBase64 = asEnabled(body.includeBase64, false);
      const requestedConcurrency = Number.parseInt(String(body.concurrency || "2"), 10);
      const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 2;
      const startedAt = Date.now();
      let successCount = 0;
      let failureCount = 0;
      const results = await runWithConcurrency(
        targets,
        async (target) => {
          const query = normalizeDashboardQueryPayload({
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
      const payload = {
        ok: true,
        action: "batch_monthly_excel",
        totalTargets: targets.length,
        successCount,
        failureCount,
        elapsedMs: Date.now() - startedAt,
        includeBase64,
        results,
      };
      if (idempotencyKey) {
        setIdempotentResult(idempotencyKey, payload);
      }
      return NextResponse.json(payload);
    }

    if (isBatchMonthlyAsyncAction(action)) {
      const bootstrap = await dashboardBootstrap(accessContext);
      const baseQuery = normalizeDashboardQueryPayload(body.query || body.filters || {});
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
      const requestedConcurrency = Number.parseInt(String(body.concurrency || "2"), 10);
      const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 2;
      const filenamePrefix = String(body.filenamePrefix || "").trim();
      const job = createBatchJob({
        totalTargets: targets.length,
      });
      runAsyncBatchJob({
        request,
        jobId: job.id,
        targets,
        baseQuery,
        filenamePrefix,
        concurrency,
      });
      logEvent("info", "n8n_batch_async_queued", {
        requestId,
        jobId: job.id,
        totalTargets: targets.length,
      });
      const payload = {
        ok: true,
        action: "batch_monthly_excel_async",
        job: batchJobStatusPayload(request, job),
      };
      if (idempotencyKey) {
        setIdempotentResult(idempotencyKey, payload);
      }
      return NextResponse.json(payload);
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
    const query = normalizeDashboardQueryPayload(body.query || body.filters || {});
    const report = await loadDashboardReport(accessContext, query);
    if (format === "xlsx") {
      const workbookBuffer = await dashboardReportWorkbookBuffer(report, query);
      const filename = workbookFilename(report, query, body.filename);
        const payload = {
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
        };
        if (idempotencyKey) {
          setIdempotentResult(idempotencyKey, payload);
        }
        return NextResponse.json(payload);
    }
    const payload = {
      ok: true,
      format: "json",
      report,
    };
    if (idempotencyKey) {
      setIdempotentResult(idempotencyKey, payload);
    }
    return NextResponse.json(payload);
  } catch (error) {
    await logAndAlertError("n8n_report_route_failed", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.code || "n8n_report_route_failed").trim() || "n8n_report_route_failed",
      message: error?.message || "Could not build report for n8n.",
    });
    if (String(error?.code || "") === "invalid_json") {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_json",
          message: "Request body must be valid JSON.",
        },
        { status: 400 },
      );
    }
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
