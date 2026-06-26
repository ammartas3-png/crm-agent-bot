import { NextResponse } from "next/server";

import { getBatchJob } from "../../../../../../../lib/n8nBatchJobs.js";
import { n8nAuthFromRequest } from "../../../../../../../lib/n8nIntegrationAuth.js";

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

export async function GET(request, context) {
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
  const jobId = String(context?.params?.jobId || "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "job_id_required", message: "jobId is required." }, { status: 400 });
  }
  const job = getBatchJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "job_not_found", message: "Batch job not found." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    action: "batch_job_status",
    job: batchJobStatusPayload(request, job),
  });
}
