import assert from "node:assert/strict";
import test from "node:test";

import {
  addBatchArtifact,
  clearBatchJobs,
  completeBatchJob,
  createBatchJob,
  getBatchArtifact,
  getBatchJob,
  startBatchJob,
  updateBatchJob,
} from "../lib/n8nBatchJobs.js";

test("n8n batch jobs lifecycle stores status and artifacts", () => {
  clearBatchJobs();
  const job = createBatchJob({ totalTargets: 2 });
  assert.ok(job.id);
  startBatchJob(job.id);
  updateBatchJob(job.id, (entry) => {
    entry.progress = 50;
  });
  const artifactId = addBatchArtifact(job.id, {
    filename: "sample.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dataBase64: Buffer.from("ok").toString("base64"),
  });
  completeBatchJob(job.id, {
    elapsedMs: 120,
    successCount: 1,
    failureCount: 1,
    results: [{ ok: true, jobArtifactId: artifactId }],
  });
  const storedJob = getBatchJob(job.id);
  assert.equal(storedJob?.status, "completed");
  assert.equal(storedJob?.progress, 50);
  const artifact = getBatchArtifact(job.id, artifactId);
  assert.equal(artifact?.filename, "sample.xlsx");
});
