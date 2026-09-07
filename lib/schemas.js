// Shared request/payload schemas (zod). These are intentionally *permissive*
// about domain contents (n8n sends arbitrary sheet columns; the dashboard sends
// many optional query params). The goal is to fail fast with a clear message on
// genuinely malformed envelopes — turning "silent wrong data" into an explicit
// 4xx — without ever rejecting a payload the previous manual checks accepted.

import { z } from "zod";

// Envelope for POST /api/ingest. Mirrors the previous manual checks exactly:
//   - sourceKey must be a non-empty string (after trimming / coercion)
//   - either rows[] or values[] must be present as an array
// Row/value *contents* stay unvalidated on purpose so valid n8n payloads never
// regress.
export const ingestBodySchema = z
  .object({
    sourceKey: z.preprocess(
      (value) => (value == null ? "" : String(value)).trim(),
      z.string().min(1, "sourceKey is required"),
    ),
    tabKey: z.union([z.string(), z.null()]).optional(),
    rows: z.array(z.any()).optional(),
    values: z.array(z.any()).optional(),
    office: z.union([z.string(), z.null()]).optional(),
    period: z.union([z.string(), z.null()]).optional(),
    category: z.union([z.string(), z.null()]).optional(),
    spreadsheetId: z.any().optional(),
    sheetRange: z.any().optional(),
  })
  .passthrough()
  .refine((body) => Array.isArray(body.rows) || Array.isArray(body.values), {
    message: "Provide rows[] (objects) or values[][] (raw sheet rows).",
    path: ["rows"],
  });

// Input to the AI ask endpoint. The route normalizes the question out of several
// possible keys before validating, so here we only require a non-empty question.
export const aiAskSchema = z.object({
  question: z
    .string({ invalid_type_error: "Missing 'question'." })
    .trim()
    .min(1, "Missing 'question'."),
  telegramUserId: z.union([z.string(), z.number(), z.null()]).optional(),
  telegramUser: z.any().optional(),
});

// Collapses a ZodError into a single human-readable string for API responses.
export function formatZodError(error) {
  if (!error || !Array.isArray(error.issues) || error.issues.length === 0) {
    return "Invalid request.";
  }
  const message = error.issues
    .map((issue) => issue?.message)
    .filter(Boolean)
    .join("; ");
  return message || "Invalid request.";
}
