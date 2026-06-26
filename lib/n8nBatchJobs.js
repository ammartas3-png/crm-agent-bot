import crypto from "node:crypto";

const DEFAULT_JOB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_JOB_MAX = 200;

const jobs = new Map();
const artifacts = new Map();

function jobTtlMs() {
  if (Number.isFinite(Number(process.env.N8N_BATCH_JOB_TTL_MS))) {
    return Math.max(30 * 1000, Number(process.env.N8N_BATCH_JOB_TTL_MS));
  }
  return DEFAULT_JOB_TTL_MS;
}

function jobMax() {
  if (Number.isFinite(Number(process.env.N8N_BATCH_JOB_MAX))) {
    return Math.max(20, Number(process.env.N8N_BATCH_JOB_MAX));
  }
  return DEFAULT_JOB_MAX;
}

function newId(prefix = "job") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function nowMs() {
  return Date.now();
}

function pruneJobs() {
  const ttl = jobTtlMs();
  const now = nowMs();
  for (const [jobId, job] of jobs.entries()) {
    if (now - Number(job.updatedAt || job.createdAt || 0) > ttl) {
      jobs.delete(jobId);
      for (const artifactId of job.artifactIds || []) {
        artifacts.delete(artifactId);
      }
    }
  }
  if (jobs.size <= jobMax()) {
    return;
  }
  const sorted = [...jobs.entries()].sort(
    (left, right) => Number(left[1]?.updatedAt || left[1]?.createdAt || 0) - Number(right[1]?.updatedAt || right[1]?.createdAt || 0),
  );
  while (jobs.size > jobMax() && sorted.length) {
    const [jobId, job] = sorted.shift();
    jobs.delete(jobId);
    for (const artifactId of job.artifactIds || []) {
      artifacts.delete(artifactId);
    }
  }
}

export function createBatchJob(payload = {}) {
  pruneJobs();
  const jobId = newId("batch");
  const job = {
    id: jobId,
    status: "queued",
    createdAt: nowMs(),
    updatedAt: nowMs(),
    progress: 0,
    totalTargets: Number(payload.totalTargets || 0),
    successCount: 0,
    failureCount: 0,
    elapsedMs: 0,
    includeBase64: false,
    results: [],
    artifactIds: [],
    error: "",
  };
  jobs.set(jobId, job);
  return job;
}

export function startBatchJob(jobId = "") {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  job.status = "running";
  job.updatedAt = nowMs();
  return job;
}

export function updateBatchJob(jobId = "", updater = null) {
  const job = jobs.get(jobId);
  if (!job || typeof updater !== "function") {
    return null;
  }
  updater(job);
  job.updatedAt = nowMs();
  return job;
}

export function completeBatchJob(jobId = "", patch = {}) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  job.status = "completed";
  job.updatedAt = nowMs();
  job.elapsedMs = Number(patch.elapsedMs || job.elapsedMs || 0);
  job.successCount = Number(patch.successCount || job.successCount || 0);
  job.failureCount = Number(patch.failureCount || job.failureCount || 0);
  job.results = Array.isArray(patch.results) ? patch.results : job.results;
  return job;
}

export function failBatchJob(jobId = "", errorMessage = "") {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  job.status = "failed";
  job.error = String(errorMessage || "").trim();
  job.updatedAt = nowMs();
  return job;
}

export function getBatchJob(jobId = "") {
  pruneJobs();
  return jobs.get(jobId) || null;
}

export function addBatchArtifact(jobId = "", artifact = {}) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  const artifactId = newId("artifact");
  artifacts.set(artifactId, {
    id: artifactId,
    jobId,
    filename: String(artifact.filename || "report.xlsx"),
    mimeType: String(artifact.mimeType || "application/octet-stream"),
    dataBase64: String(artifact.dataBase64 || ""),
    createdAt: nowMs(),
  });
  job.artifactIds.push(artifactId);
  job.updatedAt = nowMs();
  return artifactId;
}

export function getBatchArtifact(jobId = "", artifactId = "") {
  const artifact = artifacts.get(String(artifactId || ""));
  if (!artifact || String(artifact.jobId || "") !== String(jobId || "")) {
    return null;
  }
  return artifact;
}

export function clearBatchJobs() {
  jobs.clear();
  artifacts.clear();
}
