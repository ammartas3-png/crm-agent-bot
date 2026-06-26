import { NextResponse } from "next/server";

import { getBatchArtifact } from "../../../../../../../../../lib/n8nBatchJobs.js";
import { n8nAuthFromRequest } from "../../../../../../../../../lib/n8nIntegrationAuth.js";

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
  const artifactId = String(context?.params?.artifactId || "").trim();
  if (!jobId || !artifactId) {
    return NextResponse.json(
      { ok: false, error: "artifact_id_required", message: "jobId and artifactId are required." },
      { status: 400 },
    );
  }
  const artifact = getBatchArtifact(jobId, artifactId);
  if (!artifact) {
    return NextResponse.json({ ok: false, error: "artifact_not_found", message: "Artifact not found." }, { status: 404 });
  }
  const buffer = Buffer.from(String(artifact.dataBase64 || ""), "base64");
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": artifact.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${String(artifact.filename || "report.xlsx").replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
