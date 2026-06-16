import { Suspense } from "react";
import DashboardDetailsClientPage from "./details-client";

export const dynamic = "force-dynamic";

function DetailsFallback() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 12,
        background: "#edf2f7",
        color: "#0f172a",
        fontFamily: "Inter, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
      }}
    >
      Loading details...
    </main>
  );
}

export default function DashboardDetailsPage() {
  return (
    <Suspense fallback={<DetailsFallback />}>
      <DashboardDetailsClientPage />
    </Suspense>
  );
}
