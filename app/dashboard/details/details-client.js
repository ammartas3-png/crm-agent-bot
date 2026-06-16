"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./details.module.css";

const MULTI_VALUE_KEYS = new Set([
  "monthKey",
  "officeScope",
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
  "rowDimensions",
  "metricFields",
  "totalDimensions",
]);

const ENTITY_LABELS = {
  desk: "Desk",
  teamLeader: "Team Leader",
  agent: "Agent",
};

function parseList(rawValue = "") {
  return String(rawValue || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseBoolean(rawValue = "") {
  return ["1", "true", "yes", "on"].includes(String(rawValue || "").trim().toLowerCase());
}

function normalizedDetailsValue(value = "") {
  return String(value || "")
    .replace(/\s+total$/i, "")
    .trim();
}

function parseFiltersFromSearchParams(searchParams) {
  const payload = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === "detailsEntity" || key === "detailsValue" || key === "detailsLabel" || key === "contextKey") {
      continue;
    }
    if (MULTI_VALUE_KEYS.has(key)) {
      payload[key] = parseList(value);
      continue;
    }
    if (["includeWorkTime", "hideNotWorking", "benchmarkMode"].includes(key)) {
      payload[key] = parseBoolean(value);
      continue;
    }
    payload[key] = String(value || "").trim();
  }
  return payload;
}

function buildReportQuery(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (typeof value === "boolean") {
      if (value) {
        query.set(key, "1");
      }
      continue;
    }
    const normalized = Array.isArray(value)
      ? value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .join(",")
      : String(value || "").trim();
    if (normalized) {
      query.set(key, normalized);
    }
  }
  return query;
}

async function readApiPayload(response) {
  const rawText = await response.text();
  if (!rawText) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    const snippet = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      ok: false,
      error: "invalid_json_response",
      message: snippet ? `Server returned non-JSON response: ${snippet}` : "Server returned non-JSON response.",
    };
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function formatCellValue(column = {}, value) {
  if (column.type === "number") {
    return formatNumber(value);
  }
  if (column.type === "percent") {
    return formatPercent(value);
  }
  return String(value || "-");
}

function DetailTable({ title = "", report = null, emptyMessage = "No rows found." }) {
  const columns = Array.isArray(report?.builder?.columns) ? report.builder.columns : [];
  const rows = Array.isArray(report?.table) ? report.table : [];
  const displayRows = rows.slice(0, 300);
  const truncated = rows.length > displayRows.length;

  return (
    <section className={styles.panel}>
      <div className={styles.tableHeaderRow}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {truncated ? <span className={styles.inlineHint}>Showing first {displayRows.length} rows</span> : null}
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => {
              const rowKey = String(row.__rowKey || row.key || `${row.__rowKind || "row"}-${rowIndex}`);
              const isTotalRow = row.__rowKind === "total";
              return (
                <tr key={rowKey} className={isTotalRow ? styles.totalRow : ""}>
                  {columns.map((column) => {
                    const value = row[column.key];
                    const isReach = column.type === "percent" && String(column.key || "").toLowerCase().includes("reach");
                    const reachNumeric = Number(value || 0);
                    const reachStyle = isReach
                      ? reachNumeric >= 100
                        ? { background: "#dcfce7", color: "#166534", fontWeight: 700 }
                        : { background: "#fee2e2", color: "#b91c1c", fontWeight: 700 }
                      : null;
                    return (
                      <td key={`${rowKey}-${column.key}`} style={reachStyle || undefined}>
                        {formatCellValue(column, value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!displayRows.length ? (
              <tr>
                <td className={styles.emptyCell} colSpan={columns.length || 1}>
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DashboardDetailsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contextFilters, setContextFilters] = useState(null);
  const [state, setState] = useState({
    loading: true,
    error: "",
    breakdownReport: null,
    trendReport: null,
  });

  const searchKey = searchParams.toString();

  const detailTarget = useMemo(() => {
    const entityKey = String(searchParams.get("detailsEntity") || "").trim();
    const entityValue = normalizedDetailsValue(searchParams.get("detailsValue") || "");
    const detailsLabel = String(searchParams.get("detailsLabel") || entityValue || "").trim();
    return {
      entityKey,
      entityValue,
      detailsLabel,
      valid: ["desk", "teamLeader", "agent"].includes(entityKey) && Boolean(entityValue),
    };
  }, [searchParams, searchKey]);

  useEffect(() => {
    const contextKey = String(searchParams.get("contextKey") || "").trim();
    let resolved = null;
    if (contextKey) {
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          const raw = window.sessionStorage.getItem(contextKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.filters && typeof parsed.filters === "object") {
              resolved = parsed.filters;
            }
          }
          window.sessionStorage.removeItem(contextKey);
        }
      } catch {}
    }
    if (!resolved) {
      resolved = parseFiltersFromSearchParams(searchParams);
    }
    setContextFilters(resolved);
  }, [searchParams, searchKey]);

  const breakdownFilters = useMemo(() => {
    if (!contextFilters) {
      return null;
    }
    const next = {
      ...contextFilters,
      reportMode: "specific",
      specificType: "builder",
      columnDimension: "",
      includeColumnGrandTotal: false,
      agentProductivityPlanMode: false,
      last4QuickMode: false,
      benchmarkMode: false,
      totalDimensions: [],
      page: "1",
      rowLimit: "300",
      metricFields: ["leads", "ftd", "kycFtd", "cr", "crTarget", "crTargetReach", "ftdTarget", "ftdTargetReach", "selfs", "lateFtd"],
    };
    if (detailTarget.entityKey === "desk") {
      next.desk = [detailTarget.entityValue];
      next.teamLeader = [];
      next.agent = [];
      next.rowDimensions = ["teamLeader", "agent", "country", "campaign", "placement", "subCampaign", "status", "date"];
    } else if (detailTarget.entityKey === "teamLeader") {
      next.teamLeader = [detailTarget.entityValue];
      next.agent = [];
      next.rowDimensions = ["agent", "country", "campaign", "placement", "subCampaign", "status", "date"];
    } else {
      next.agent = [detailTarget.entityValue];
      next.rowDimensions = ["date", "hour", "country", "campaign", "placement", "subCampaign", "status"];
    }
    return next;
  }, [contextFilters, detailTarget.entityKey, detailTarget.entityValue]);

  const trendFilters = useMemo(() => {
    if (!breakdownFilters) {
      return null;
    }
    const next = {
      ...breakdownFilters,
      rowLimit: "120",
      metricFields: ["leads", "ftd", "kycFtd", "cr", "crTargetReach", "ftdTargetReach"],
      rowDimensions: detailTarget.entityKey === "agent" ? ["date", "hour"] : ["date"],
    };
    return next;
  }, [breakdownFilters, detailTarget.entityKey]);

  const breakdownQuery = useMemo(() => (breakdownFilters ? buildReportQuery(breakdownFilters).toString() : ""), [breakdownFilters]);
  const trendQuery = useMemo(() => (trendFilters ? buildReportQuery(trendFilters).toString() : ""), [trendFilters]);

  useEffect(() => {
    let cancelled = false;
    if (!contextFilters || !breakdownQuery || !trendQuery) {
      return undefined;
    }
    if (!detailTarget.valid) {
      setState({
        loading: false,
        error: "Missing details target. Go back and right-click a Desk, Team Leader, or Agent row.",
        breakdownReport: null,
        trendReport: null,
      });
      return undefined;
    }
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const [breakdownResponse, trendResponse] = await Promise.all([
          fetch(`/api/dashboard/report?${breakdownQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${trendQuery}`, { cache: "no-store" }),
        ]);
        const [breakdownPayload, trendPayload] = await Promise.all([
          readApiPayload(breakdownResponse),
          readApiPayload(trendResponse),
        ]);
        if (!breakdownResponse.ok || breakdownPayload?.ok === false) {
          throw new Error(breakdownPayload?.message || breakdownPayload?.error || "Could not load detailed breakdown report.");
        }
        if (!trendResponse.ok || trendPayload?.ok === false) {
          throw new Error(trendPayload?.message || trendPayload?.error || "Could not load trend report.");
        }
        if (!cancelled) {
          setState({
            loading: false,
            error: "",
            breakdownReport: breakdownPayload.report || null,
            trendReport: trendPayload.report || null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error?.message || "Could not load details report.",
            breakdownReport: null,
            trendReport: null,
          });
        }
      }
    };
    const timerId = window.setTimeout(load, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [breakdownQuery, contextFilters, detailTarget.valid, trendQuery]);

  const summary = state.breakdownReport?.summary || {};
  const summaryItems = [
    { label: "Leads", value: formatNumber(summary.totalLeads || summary.leads || 0) },
    { label: "FTD", value: formatNumber(summary.totalFtd || summary.ftd || 0) },
    { label: "KYC FTD", value: formatNumber(summary.kycFtd || 0) },
    { label: "CR", value: formatPercent(summary.cr || 0) },
    { label: "CR Target Reach", value: formatPercent(summary.crTargetReach || 0) },
    { label: "FTD Target Reach", value: formatPercent(summary.ftdTargetReach || 0) },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <button type="button" className={styles.backButton} onClick={() => router.push("/dashboard")}>
            ← Back to Dashboard
          </button>
        </div>
        <h1 className={styles.title}>Detailed Report</h1>
        <p className={styles.subtitle}>
          {ENTITY_LABELS[detailTarget.entityKey] || "Entity"}: <strong>{detailTarget.detailsLabel || detailTarget.entityValue || "-"}</strong>
        </p>
        <p className={styles.subtitle}>
          Office:{" "}
          <strong>{Array.isArray(contextFilters?.officeScope) && contextFilters.officeScope.length ? contextFilters.officeScope[0] : "-"}</strong>{" "}
          | Months:{" "}
          <strong>
            {Array.isArray(contextFilters?.monthKey) && contextFilters.monthKey.length ? contextFilters.monthKey.join(", ") : "-"}
          </strong>
        </p>
      </section>

      {state.loading ? (
        <section className={styles.panel}>
          <p className={styles.loading}>Loading detailed report...</p>
        </section>
      ) : null}
      {state.error ? (
        <section className={styles.panel}>
          <p className={styles.error}>{state.error}</p>
        </section>
      ) : null}
      {!state.loading && !state.error ? (
        <>
          <section className={`${styles.panel} ${styles.summaryGrid}`}>
            {summaryItems.map((item) => (
              <div key={item.label} className={styles.summaryCard}>
                <div className={styles.summaryLabel}>{item.label}</div>
                <div className={styles.summaryValue}>{item.value}</div>
              </div>
            ))}
          </section>
          <DetailTable title="Daily Trend" report={state.trendReport} emptyMessage="No daily trend rows found." />
          <DetailTable title="Detailed Breakdown" report={state.breakdownReport} emptyMessage="No detailed rows found." />
        </>
      ) : null}
    </main>
  );
}
