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

function formatDecimal(value, digits = 2) {
  const numeric = Number(value || 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return safe.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

function benchmarkMetricsFromReport(report = null) {
  const summary = report?.summary || {};
  const tableRows = Array.isArray(report?.table) ? report.table : [];
  const firstDataRow = tableRows.find((row) => row?.__rowKind !== "total") || tableRows[0] || {};
  const deskAvgRaw = summary.avgFtdByDeskLongTerm ?? firstDataRow.avgFtdByDeskLongTerm;
  const benchmarkRateRaw = summary.ftdBenchmarkRate ?? firstDataRow.ftdBenchmarkRate;
  const leadsRaw = summary.totalLeads ?? summary.leads ?? firstDataRow.leads;
  const ftdRaw = summary.totalFtd ?? summary.ftd ?? firstDataRow.ftd;
  return {
    deskAvgFtdLongTerm: Number(deskAvgRaw || 0),
    benchmarkRate: Number(benchmarkRateRaw || 0),
    leads: Number(leadsRaw || 0),
    ftd: Number(ftdRaw || 0),
  };
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
    leadsReport: null,
    benchmarkReport: null,
    last4Rows: [],
    last4Loading: false,
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

  const entityScopedBaseFilters = useMemo(() => {
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
      includeWorkTime: false,
      hideNotWorking: false,
      totalDimensions: [],
    };
    if (detailTarget.entityKey === "desk") {
      next.desk = [detailTarget.entityValue];
      next.teamLeader = [];
      next.agent = [];
    } else if (detailTarget.entityKey === "teamLeader") {
      next.teamLeader = [detailTarget.entityValue];
      next.agent = [];
    } else {
      next.agent = [detailTarget.entityValue];
    }
    return next;
  }, [contextFilters, detailTarget.entityKey, detailTarget.entityValue]);

  const trendFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "220",
      metricFields: ["leads", "ftd", "kycFtd", "cr", "crTargetReach", "ftdTargetReach"],
      rowDimensions: detailTarget.entityKey === "agent" ? ["date", "hour"] : ["date"],
    };
  }, [detailTarget.entityKey, entityScopedBaseFilters]);

  const leadsTableFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "220",
      rowDimensions: ["brand", "id", "created", "department", "status", "country", "campaign", "subCampaign", "placement", "agent"],
      metricFields: ["ftd"],
    };
  }, [entityScopedBaseFilters]);

  const breakdownFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    const next = {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "280",
      metricFields: ["leads", "ftd", "kycFtd", "cr", "crTarget", "crTargetReach", "ftdTarget", "ftdTargetReach", "selfs", "lateFtd"],
    };
    if (detailTarget.entityKey === "desk") {
      next.rowDimensions = ["teamLeader", "agent", "country", "campaign", "placement", "subCampaign", "status", "date"];
    } else if (detailTarget.entityKey === "teamLeader") {
      next.rowDimensions = ["agent", "country", "campaign", "placement", "subCampaign", "status", "date"];
    } else {
      next.rowDimensions = ["date", "hour", "country", "campaign", "placement", "subCampaign", "status"];
    }
    return next;
  }, [detailTarget.entityKey, entityScopedBaseFilters]);

  const benchmarkFilters = useMemo(() => {
    if (!entityScopedBaseFilters) {
      return null;
    }
    return {
      ...entityScopedBaseFilters,
      page: "1",
      rowLimit: "40",
      benchmarkMode: true,
      rowDimensions: [detailTarget.entityKey],
      metricFields: ["avgFtdByDeskLongTerm", "ftdBenchmarkRate", "leads", "ftd"],
    };
  }, [detailTarget.entityKey, entityScopedBaseFilters]);

  const breakdownQuery = useMemo(() => (breakdownFilters ? buildReportQuery(breakdownFilters).toString() : ""), [breakdownFilters]);
  const trendQuery = useMemo(() => (trendFilters ? buildReportQuery(trendFilters).toString() : ""), [trendFilters]);
  const leadsQuery = useMemo(() => (leadsTableFilters ? buildReportQuery(leadsTableFilters).toString() : ""), [leadsTableFilters]);
  const benchmarkQuery = useMemo(
    () => (benchmarkFilters ? buildReportQuery(benchmarkFilters).toString() : ""),
    [benchmarkFilters],
  );

  useEffect(() => {
    let cancelled = false;
    if (!contextFilters || !breakdownQuery || !trendQuery || !leadsQuery || !benchmarkQuery) {
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
      setState((prev) => ({ ...prev, loading: true, error: "", last4Rows: [], last4Loading: false }));
      try {
        const [breakdownResponse, trendResponse, leadsResponse, benchmarkResponse] = await Promise.all([
          fetch(`/api/dashboard/report?${breakdownQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${trendQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${leadsQuery}`, { cache: "no-store" }),
          fetch(`/api/dashboard/report?${benchmarkQuery}`, { cache: "no-store" }),
        ]);
        const [breakdownPayload, trendPayload, leadsPayload, benchmarkPayload] = await Promise.all([
          readApiPayload(breakdownResponse),
          readApiPayload(trendResponse),
          readApiPayload(leadsResponse),
          readApiPayload(benchmarkResponse),
        ]);
        if (!breakdownResponse.ok || breakdownPayload?.ok === false) {
          throw new Error(breakdownPayload?.message || breakdownPayload?.error || "Could not load detailed breakdown report.");
        }
        if (!trendResponse.ok || trendPayload?.ok === false) {
          throw new Error(trendPayload?.message || trendPayload?.error || "Could not load trend report.");
        }
        if (!leadsResponse.ok || leadsPayload?.ok === false) {
          throw new Error(leadsPayload?.message || leadsPayload?.error || "Could not load leads details table.");
        }
        if (!benchmarkResponse.ok || benchmarkPayload?.ok === false) {
          throw new Error(benchmarkPayload?.message || benchmarkPayload?.error || "Could not load benchmark details.");
        }
        const breakdownReport = breakdownPayload.report || null;
        const trendReport = trendPayload.report || null;
        const leadsReport = leadsPayload.report || null;
        const benchmarkReport = benchmarkPayload.report || null;
        const monthOptions = Array.isArray(breakdownReport?.options?.months) ? breakdownReport.options.months : [];
        const monthKeysFromOptions = monthOptions.map((month) => String(month?.key || "").trim()).filter(Boolean);
        const monthKeysFromFilters = Array.isArray(contextFilters?.monthKey) ? contextFilters.monthKey.filter(Boolean) : [];
        const last4MonthKeys = [...new Set(monthKeysFromOptions.length ? monthKeysFromOptions : monthKeysFromFilters)].slice(0, 4);
        const monthLabelByKey = new Map(
          monthOptions
            .map((month) => [String(month?.key || "").trim(), String(month?.month_label || month?.label || month?.key || "").trim()])
            .filter(([key]) => Boolean(key)),
        );
        if (!cancelled) {
          setState({
            loading: false,
            error: "",
            breakdownReport,
            trendReport,
            leadsReport,
            benchmarkReport,
            last4Rows: [],
            last4Loading: last4MonthKeys.length > 0,
          });
        }
        if (!last4MonthKeys.length) {
          return;
        }
        const monthSummaryRequests = await Promise.all(
          last4MonthKeys.map(async (monthKey) => {
            const monthQuery = buildReportQuery({
              ...entityScopedBaseFilters,
              monthKey: [monthKey],
              rowDimensions: [detailTarget.entityKey],
              metricFields: ["leads", "ftd", "cr", "crTargetReach", "ftdTargetReach"],
              includeWorkTime: false,
              benchmarkMode: false,
              page: "1",
              rowLimit: "40",
            }).toString();
            const response = await fetch(`/api/dashboard/report?${monthQuery}`, { cache: "no-store" });
            const payload = await readApiPayload(response);
            if (!response.ok || payload?.ok === false) {
              throw new Error(payload?.message || payload?.error || `Could not load ${monthKey} monthly summary.`);
            }
            return {
              monthKey,
              monthLabel: monthLabelByKey.get(monthKey) || monthKey,
              summary: payload?.report?.summary || {},
            };
          }),
        );
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            last4Rows: monthSummaryRequests,
            last4Loading: false,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error?.message || "Could not load details report.",
            breakdownReport: null,
            trendReport: null,
            leadsReport: null,
            benchmarkReport: null,
            last4Rows: [],
            last4Loading: false,
          });
        }
      }
    };
    const timerId = window.setTimeout(load, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    benchmarkQuery,
    breakdownQuery,
    contextFilters,
    detailTarget.entityKey,
    detailTarget.valid,
    entityScopedBaseFilters,
    leadsQuery,
    trendQuery,
  ]);

  const summary = state.breakdownReport?.summary || {};
  const summaryItems = [
    { label: "Leads", value: formatNumber(summary.totalLeads || summary.leads || 0) },
    { label: "FTD", value: formatNumber(summary.totalFtd || summary.ftd || 0) },
    { label: "KYC FTD", value: formatNumber(summary.kycFtd || 0) },
    { label: "CR", value: formatPercent(summary.cr || 0) },
    { label: "CR Target Reach", value: formatPercent(summary.crTargetReach || 0) },
    { label: "FTD Target Reach", value: formatPercent(summary.ftdTargetReach || 0) },
  ];
  const benchmarkMetrics = benchmarkMetricsFromReport(state.benchmarkReport);

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
          <section className={styles.panel}>
            <div className={styles.tableHeaderRow}>
              <h2 className={styles.sectionTitle}>Last 4 Months Results</h2>
            </div>
            {state.last4Loading ? <p className={styles.loading}>Loading last 4 months...</p> : null}
            {!state.last4Loading ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Leads</th>
                      <th>FTD</th>
                      <th>CR</th>
                      <th>CR Target Reach</th>
                      <th>FTD Target Reach</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.last4Rows.map((item) => (
                      <tr key={item.monthKey}>
                        <td>{item.monthLabel || item.monthKey}</td>
                        <td>{formatNumber(item.summary?.totalLeads || item.summary?.leads || 0)}</td>
                        <td>{formatNumber(item.summary?.totalFtd || item.summary?.ftd || 0)}</td>
                        <td>{formatPercent(item.summary?.cr || 0)}</td>
                        <td>{formatPercent(item.summary?.crTargetReach || 0)}</td>
                        <td>{formatPercent(item.summary?.ftdTargetReach || 0)}</td>
                      </tr>
                    ))}
                    {!state.last4Rows.length ? (
                      <tr>
                        <td className={styles.emptyCell} colSpan={6}>
                          No month summary found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
          <section className={`${styles.panel} ${styles.summaryGrid}`}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Desk Avg FTD per Desk By Long Term</div>
              <div className={styles.summaryValue}>{formatDecimal(benchmarkMetrics.deskAvgFtdLongTerm, 2)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark Rate</div>
              <div className={styles.summaryValue}>{formatPercent(benchmarkMetrics.benchmarkRate)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark Leads</div>
              <div className={styles.summaryValue}>{formatNumber(benchmarkMetrics.leads)}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Benchmark FTD</div>
              <div className={styles.summaryValue}>{formatNumber(benchmarkMetrics.ftd)}</div>
            </div>
          </section>
          <section className={styles.dualGrid}>
            <DetailTable title="Daily Trend" report={state.trendReport} emptyMessage="No daily trend rows found." />
            <DetailTable
              title="Leads Sheet Fields"
              report={state.leadsReport}
              emptyMessage="No leads rows found for selected filters."
            />
          </section>
          <DetailTable title="Detailed Breakdown" report={state.breakdownReport} emptyMessage="No detailed rows found." />
        </>
      ) : null}
    </main>
  );
}
