export function mapDashboardServiceError(error, fallbackCode = "dashboard_route_failed") {
  const code = String(error?.code || "").trim();
  const isTooHeavy = code === "report_too_heavy";
  return {
    status: isTooHeavy ? 422 : 500,
    body: {
      ok: false,
      error: isTooHeavy ? "report_too_heavy" : fallbackCode,
      message: error?.message || "Request failed.",
      stage: String(error?.stage || "").trim(),
    },
  };
}
