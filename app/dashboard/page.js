"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function reachColor(value) {
  const number = Number(value || 0);
  if (number >= 100) {
    return "#15803d";
  }
  if (number >= 80) {
    return "#b45309";
  }
  return "#b91c1c";
}

function officeThemeForName(officeName = "") {
  const normalized = String(officeName || "").toLowerCase();
  if (normalized.includes("argentina")) {
    return {
      background: "linear-gradient(180deg, #ecfeff 0%, #e0f2fe 100%)",
      borderColor: "#7dd3fc",
      color: "#0c4a6e",
    };
  }
  if (normalized.includes("dubai") || normalized.includes("uae")) {
    return {
      background: "linear-gradient(180deg, #ecfdf5 0%, #dcfce7 100%)",
      borderColor: "#86efac",
      color: "#14532d",
    };
  }
  if (normalized.includes("pakistan")) {
    return {
      background: "linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)",
      borderColor: "#86efac",
      color: "#14532d",
    };
  }
  if (normalized.includes("turkiye") || normalized.includes("turkey")) {
    return {
      background: "linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%)",
      borderColor: "#fca5a5",
      color: "#7f1d1d",
    };
  }
  return {
    background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
    borderColor: "#c9d5e4",
    color: "#0f172a",
  };
}

function reportModeMeta(mode = "") {
  if (mode === "monthly") {
    return { title: "Monthly Report", icon: "📊" };
  }
  if (mode === "last4") {
    return { title: "Last 4 Months Report", icon: "📅" };
  }
  return { title: "Custom Report Builder", icon: "🧩" };
}

function TelegramLoginWidget({ botUsername, onAuth }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!botUsername || !containerRef.current) {
      return undefined;
    }
    const container = containerRef.current;
    container.innerHTML = "";
    globalThis.crmDashboardTelegramAuth = async (user) => {
      await onAuth(user);
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "crmDashboardTelegramAuth(user)");
    script.setAttribute("data-lang", "en");
    container.appendChild(script);
    return () => {
      delete globalThis.crmDashboardTelegramAuth;
      container.innerHTML = "";
    };
  }, [botUsername, onAuth]);
  return <div ref={containerRef} />;
}

function SelectFilter({ label, value, options, onChange, placeholder = "All", disabled = false, loading = false }) {
  return (
    <label className={styles.selectWrap}>
      <span className={styles.selectLabelRow}>
        <span className={styles.selectLabel}>{label}</span>
        {loading ? <span className={styles.selectSpinner} aria-hidden="true" /> : null}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={styles.selectInput}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildReportQuery(filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
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

function sanitizeFiltersWithOptions(sourceFilters = {}, options = {}) {
  const next = { ...sourceFilters };
  if (Array.isArray(options.months) && options.months.length) {
    const monthExists = options.months.some((month) => month.key === next.monthKey);
    if (!monthExists) {
      next.monthKey = options.months[0].key;
    }
  }
  const dependencyChecks = [
    ["date", options.dates || []],
    ["hour", options.hours || []],
    ["desk", options.desks || []],
    ["country", options.countries || []],
    ["brand", options.brands || []],
    ["campaign", options.campaigns || []],
    ["subCampaign", options.subCampaigns || []],
    ["placement", options.placements || []],
    ["status", options.statuses || []],
    ["teamLeader", options.teamLeaders || []],
    ["agent", options.agents || []],
  ];
  for (const [key, values] of dependencyChecks) {
    if (next[key] && !values.includes(next[key])) {
      next[key] = "";
    }
  }
  return next;
}

function ToggleGroup({ label, items, selectedItems, onToggle }) {
  const selectedLabels = selectedItems
    .map((key) => items.find((item) => item.key === key)?.label || "")
    .filter(Boolean);
  return (
    <div className={styles.chipSection}>
      <div className={styles.chipTitle}>{label}</div>
      <div className={styles.chipList}>
        {items.map((item) => {
          const active = selectedItems.includes(item.key);
          const orderIndex = selectedItems.indexOf(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onToggle(item.key)}
              className={`${styles.chip} ${active ? styles.chipActive : ""}`}
            >
              <span className={styles.chipInner}>
                {active ? <span className={styles.chipCheck}>✓</span> : null}
                {active && orderIndex >= 0 ? <span className={styles.chipOrder}>{orderIndex + 1}</span> : null}
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.orderPreview}>
        <div className={styles.orderLabel}>{label} Order</div>
        <div className={styles.orderValue}>
          {selectedLabels.length ? selectedLabels.map((item, index) => `${index + 1}. ${item}`).join("  •  ") : "No selection"}
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ summary }) {
  const items = [
    { label: "Total Leads", value: formatNumber(summary.totalLeads) },
    { label: "Total FTD", value: formatNumber(summary.totalFtd) },
    { label: "FTD Target", value: formatNumber(summary.ftdTarget) },
    {
      label: "FTD Target Reach",
      value: formatPercent(summary.ftdTargetReach),
      color: reachColor(summary.ftdTargetReach),
    },
    { label: "CR", value: formatPercent(summary.cr) },
    { label: "CR Target", value: formatPercent(summary.crTarget) },
    {
      label: "CR Target Reach",
      value: formatPercent(summary.crTargetReach),
      color: reachColor(summary.crTargetReach),
    },
  ];
  return (
    <div className={styles.cardGrid}>
      {items.map((item) => (
        <div key={item.label} className={`${styles.panel} ${styles.metricCard}`}>
          <div className={styles.metricLabel}>{item.label}</div>
          <div className={styles.metricValue} style={{ color: item.color || "#0f172a" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusCards({ stats = {} }) {
  const items = [
    ["Total Agent", formatNumber(stats.totalAgent)],
    ["Team Leader Total", formatNumber(stats.teamLeaderTotal)],
    ["Desk Total", formatNumber(stats.deskTotal)],
    ["Total Target Achieved", formatNumber(stats.totalTargetAchieved)],
    ["Rate Of Target Achieved", formatPercent(stats.rateOfTargetAchieved)],
  ];
  return (
    <div className={`${styles.panel} ${styles.statusGrid}`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <div className={styles.statusLabel}>{label}</div>
          <div className={styles.statusValue}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({ rows = [] }) {
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {["Group", "Leads", "FTD", "FTD Target", "FTD Target Reach", "CR", "CR Target", "CR Target Reach", "Selfs", "Late FTD"].map(
              (header) => (
                <th key={header}>
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.monthKey || row.label}>
              <td className={styles.tableStrong}>{row.label}</td>
              <td>{formatNumber(row.totalLeads)}</td>
              <td>{formatNumber(row.totalFtd)}</td>
              <td>{formatNumber(row.ftdTarget)}</td>
              <td style={{ color: reachColor(row.ftdTargetReach) }}>
                {formatPercent(row.ftdTargetReach)}
              </td>
              <td>{formatPercent(row.cr)}</td>
              <td>{formatPercent(row.crTarget)}</td>
              <td style={{ color: reachColor(row.crTargetReach) }}>
                {formatPercent(row.crTargetReach)}
              </td>
              <td>{formatNumber(row.selfs)}</td>
              <td>{formatNumber(row.lateFtd)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={10} className={styles.tableEmpty}>
                No rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function PivotTable({ rows = [], summary = {} }) {
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table className={styles.table} style={{ minWidth: 1150 }}>
        <thead>
          <tr>
            {[
              "Desk",
              "Team Leader",
              "Agent",
              "Leads",
              "FTD",
              "Selfs",
              "Late FTD +30 Day",
              "CR",
              "CR Target",
              "CR Target Reach",
              "FTD Target",
              "FTD Target Reach",
            ].map((header) => (
              <th key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.desk}-${row.teamLeader}-${row.agent}`}>
              <td>{row.desk}</td>
              <td>{row.teamLeader}</td>
              <td className={styles.tableStrong}>{row.agent}</td>
              <td>{formatNumber(row.totalLeads)}</td>
              <td>{formatNumber(row.totalFtd)}</td>
              <td>{formatNumber(row.selfs)}</td>
              <td>{formatNumber(row.lateFtd)}</td>
              <td>{formatPercent(row.cr)}</td>
              <td>{formatPercent(row.crTarget)}</td>
              <td style={{ color: reachColor(row.crTargetReach) }}>
                {formatPercent(row.crTargetReach)}
              </td>
              <td>{formatNumber(row.ftdTarget)}</td>
              <td style={{ color: reachColor(row.ftdTargetReach) }}>
                {formatPercent(row.ftdTargetReach)}
              </td>
            </tr>
          ))}
          <tr>
            <td className={styles.tableStrong}>Grand total</td>
            <td />
            <td />
            <td className={styles.tableStrong}>{formatNumber(summary.totalLeads)}</td>
            <td className={styles.tableStrong}>{formatNumber(summary.totalFtd)}</td>
            <td className={styles.tableStrong}>{formatNumber(summary.selfs)}</td>
            <td className={styles.tableStrong}>{formatNumber(summary.lateFtd)}</td>
            <td className={styles.tableStrong}>{formatPercent(summary.cr)}</td>
            <td className={styles.tableStrong}>{formatPercent(summary.crTarget)}</td>
            <td className={styles.tableStrong} style={{ color: reachColor(summary.crTargetReach) }}>
              {formatPercent(summary.crTargetReach)}
            </td>
            <td className={styles.tableStrong}>{formatNumber(summary.ftdTarget)}</td>
            <td className={styles.tableStrong} style={{ color: reachColor(summary.ftdTargetReach) }}>
              {formatPercent(summary.ftdTargetReach)}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}

const LAST4_MONTH_THEMES = [
  { dark: "#1d4ed8", light: "#dbeafe", line: "#1e3a8a" },
  { dark: "#7c3aed", light: "#ede9fe", line: "#4c1d95" },
  { dark: "#c2410c", light: "#ffedd5", line: "#9a3412" },
  { dark: "#0f766e", light: "#ccfbf1", line: "#134e4a" },
  { dark: "#be123c", light: "#ffe4e6", line: "#881337" },
  { dark: "#475569", light: "#e2e8f0", line: "#334155" },
];

function last4MonthTheme(index) {
  return LAST4_MONTH_THEMES[index % LAST4_MONTH_THEMES.length];
}

function Last4MatrixTable({ rows = [], monthBlocks = [] }) {
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table className={styles.table} style={{ minWidth: 1880 }}>
        <thead>
          <tr>
            <th
              rowSpan={2}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
              }}
            >
              Desk
            </th>
            <th
              rowSpan={2}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
              }}
            >
              Team Leader
            </th>
            <th
              rowSpan={2}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
              }}
            >
              Agent
            </th>
            {monthBlocks.map((month, index) => {
              const theme = last4MonthTheme(index);
              return (
              <th
                key={month.key}
                colSpan={6}
                style={{
                  textAlign: "center",
                  padding: "9px 12px",
                  borderBottom: "1px solid #dbe3ee",
                  fontSize: 12,
                  background: theme.dark,
                  color: "#fff",
                  borderLeft: `3px solid ${theme.line}`,
                  borderRight: `3px solid ${theme.line}`,
                }}
              >
                {month.label}
              </th>
              );
            })}
            <th
              rowSpan={2}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
              }}
            >
              Starting Date
            </th>
            <th
              rowSpan={2}
              style={{
                textAlign: "left",
                padding: "9px 12px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
              }}
            >
              Months Worked
            </th>
          </tr>
          <tr>
            {monthBlocks.map((month, index) => (
              <FragmentMetricHeaders key={month.key} theme={last4MonthTheme(index)} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key || row.agent}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.desk}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.teamLeader}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.agent}</td>
              {monthBlocks.map((month, index) => {
                const metric = row.months?.[month.key] || {};
                const theme = last4MonthTheme(index);
                return (
                  <FragmentMetricCells key={`${row.key || row.agent}-${month.key}`} metric={metric} theme={theme} />
                );
              })}
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.startDate || "-"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>
                {row.monthsWorked === "-" ? "-" : `${row.monthsWorked} month${Number(row.monthsWorked) === 1 ? "" : "s"}`}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5 + monthBlocks.length * 6} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function FragmentMetricHeaders({ theme }) {
  const baseStyle = {
    textAlign: "left",
    padding: "7px 10px",
    borderBottom: "1px solid #dbe3ee",
    fontSize: 11,
    background: theme?.light || "#f8fafc",
    color: "#0f172a",
  };
  return (
    <>
      <th style={{ ...baseStyle, borderLeft: `3px solid ${theme?.line || "#334155"}` }}>Target</th>
      <th style={baseStyle}>FTD</th>
      <th style={baseStyle}>CR</th>
      <th style={baseStyle}>CR Target</th>
      <th style={baseStyle}>CR Reach</th>
      <th style={{ ...baseStyle, borderRight: `3px solid ${theme?.line || "#334155"}` }}>FTD Reach</th>
    </>
  );
}

function FragmentMetricCells({ metric = {}, theme }) {
  const crReach = Number(metric.crTargetReach || 0);
  const ftdReach = Number(metric.ftdTargetReach || 0);
  const baseStyle = {
    padding: "8px 10px",
    borderBottom: "1px solid #eef2f7",
    background: theme?.light || "#fff",
  };
  return (
    <>
      <td style={{ ...baseStyle, borderLeft: `3px solid ${theme?.line || "#334155"}` }}>{formatNumber(metric.target)}</td>
      <td style={baseStyle}>{formatNumber(metric.ftd)}</td>
      <td style={baseStyle}>{formatPercent(metric.cr)}</td>
      <td style={baseStyle}>{formatPercent(metric.crTarget)}</td>
      <td
        style={{
          ...baseStyle,
          color: reachColor(crReach),
          fontWeight: crReach >= 100 ? 700 : 400,
        }}
      >
        {formatPercent(metric.crTargetReach)}
      </td>
      <td
        style={{
          ...baseStyle,
          borderRight: `3px solid ${theme?.line || "#334155"}`,
          color: reachColor(ftdReach),
          fontWeight: ftdReach >= 100 ? 700 : 400,
        }}
      >
        {formatPercent(metric.ftdTargetReach)}
      </td>
    </>
  );
}

function LoadingReportIndicator() {
  return (
    <section className={`${styles.panel} ${styles.loadingCard}`}>
      <div className={styles.loadingTitle}>
        <span className={styles.loadingIcon}>🤖</span>
        <span>Building your report...</span>
      </div>
      <div className={styles.loadingTrack}>
        <div className={styles.loadingBar} />
      </div>
      <p className={styles.loadingHint}>Please wait, data is being fetched and calculated.</p>
    </section>
  );
}

function formatBuilderCell(value, type) {
  if (type === "number") {
    return formatNumber(value);
  }
  if (type === "percent") {
    return formatPercent(value);
  }
  return String(value ?? "-");
}

function compareBuilderValues(left, right, type) {
  if (type === "number" || type === "percent") {
    return Number(left || 0) - Number(right || 0);
  }
  return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true, sensitivity: "base" });
}

function BuilderTable({ columns = [], rows = [], sortState, onSort }) {
  return (
    <div className={`${styles.panel} ${styles.tableCard}`} style={{ maxHeight: "70vh" }}>
      <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.tableSticky}`} style={{ minWidth: 900 }}>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortState.key === column.key;
              const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  key={column.key}
                  onClick={() => onSort(column.key)}
                  style={{
                    cursor: "pointer",
                  }}
                >
                  {column.label}
                  {suffix}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`builder-${index}`}>
              {columns.map((column) => {
                const isReach = column.type === "percent" && column.key.toLowerCase().includes("reach");
                const value = row[column.key];
                return (
                  <td
                    key={`${index}-${column.key}`}
                    style={{
                      color: isReach ? reachColor(value) : "#0f172a",
                    }}
                  >
                    {formatBuilderCell(value, column.type)}
                  </td>
                );
              })}
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={columns.length || 1} className={styles.tableEmpty}>
                No data found for current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const DEFAULT_BUILDER_DIMENSIONS = [
  { key: "date", label: "Date", type: "date" },
  { key: "hour", label: "Hour", type: "hour" },
  { key: "desk", label: "Desk", type: "text" },
  { key: "teamLeader", label: "Team Leader", type: "text" },
  { key: "agent", label: "Agent", type: "text" },
  { key: "status", label: "Working Status", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "campaign", label: "Campaign", type: "text" },
  { key: "subCampaign", label: "Sub Campaign", type: "text" },
  { key: "placement", label: "Placement", type: "text" },
];

const DEFAULT_BUILDER_METRICS = [
  { key: "leads", label: "Leads", type: "number" },
  { key: "ftd", label: "FTD", type: "number" },
  { key: "ftdTarget", label: "FTD Target", type: "number" },
  { key: "ftdTargetReach", label: "FTD Target Reach", type: "percent" },
  { key: "cr", label: "CR", type: "percent" },
  { key: "crTarget", label: "CR Target", type: "percent" },
  { key: "crTargetReach", label: "CR Target Reach", type: "percent" },
  { key: "selfs", label: "Selfs", type: "number" },
  { key: "lateFtd", label: "Late FTD", type: "number" },
  { key: "ftdTargetByCr", label: "FTD Target by CR", type: "number" },
  { key: "missingFtd", label: "Missing FTD", type: "number" },
];

const EMPTY_FILTERS = {
  officeScope: "",
  reportMode: "",
  specificType: "builder",
  monthKey: "",
  date: "",
  hour: "",
  desk: "",
  country: "",
  brand: "",
  campaign: "",
  subCampaign: "",
  placement: "",
  status: "",
  teamLeader: "",
  agent: "",
  groupBy: "agent",
  rowDimensions: ["date", "desk", "teamLeader", "agent"],
  metricFields: ["leads", "ftd", "ftdTarget", "ftdTargetReach", "cr", "crTarget", "crTargetReach"],
};

function asOptions(values = []) {
  return values.map((value) => ({ value, label: value }));
}

export default function DashboardPage() {
  const [sessionState, setSessionState] = useState({
    loading: true,
    authenticated: false,
    authorized: false,
    auth: { enabled: false, botUsername: "" },
    user: null,
    bootstrap: { defaultMonthKey: "", months: [], officeScopes: [] },
    error: "",
  });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [reportState, setReportState] = useState({
    loading: false,
    report: null,
    error: "",
  });
  const [builderSort, setBuilderSort] = useState({ key: "", direction: "asc" });
  const [exportState, setExportState] = useState({ loading: false, error: "" });

  const fetchSession = useCallback(async () => {
    setSessionState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const response = await fetch("/api/dashboard/session", { cache: "no-store" });
      const payload = await response.json();
      const officeScopes = payload.bootstrap?.officeScopes || [];
      setSessionState({
        loading: false,
        authenticated: Boolean(payload.authenticated),
        authorized: Boolean(payload.authorized),
        auth: payload.auth || { enabled: false, botUsername: "" },
        user: payload.user || null,
        bootstrap: payload.bootstrap || { defaultMonthKey: "", months: [], officeScopes: [] },
        error: "",
      });
      setFilters((prev) => ({
        ...prev,
        officeScope: prev.officeScope || (officeScopes.length === 1 ? officeScopes[0] : ""),
        monthKey: prev.monthKey || payload.bootstrap?.defaultMonthKey || "",
      }));
    } catch {
      setSessionState((prev) => ({
        ...prev,
        loading: false,
        error: "Could not load dashboard session.",
      }));
    }
  }, []);

  const requestReport = useCallback(async () => {
    if (!sessionState.authorized || !filters.officeScope || !filters.reportMode) {
      setReportState((prev) => ({ ...prev, report: null, loading: false }));
      return;
    }
    setReportState({
      loading: true,
      report: null,
      error: "",
    });
    setExportState((prev) => ({ ...prev, error: "" }));
    try {
      const query = buildReportQuery(filters);
      const response = await fetch(`/api/dashboard/report?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.message || payload?.error || "Could not load report.");
      }
      setReportState({
        loading: false,
        report: payload.report,
        error: "",
      });
      const options = payload.report?.options || {};
      setFilters((prev) => {
        const sanitized = sanitizeFiltersWithOptions(prev, options);
        const prevKey = buildReportQuery(prev).toString();
        const sanitizedKey = buildReportQuery(sanitized).toString();
        return prevKey === sanitizedKey ? prev : sanitized;
      });
    } catch (error) {
      setReportState({
        loading: false,
        report: null,
        error: error?.message || "Could not load report.",
      });
    }
  }, [filters, sessionState.authorized]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    requestReport();
  }, [requestReport]);

  const handleTelegramAuth = useCallback(
    async (user) => {
      setSessionState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const response = await fetch("/api/dashboard/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user || {}),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          throw new Error(payload?.error || "Telegram login failed.");
        }
        await fetchSession();
      } catch (error) {
        setSessionState((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || "Telegram login failed.",
        }));
      }
    },
    [fetchSession],
  );

  const handleLogout = useCallback(async () => {
    await fetch("/api/dashboard/auth/logout", { method: "POST" }).catch(() => {});
    setReportState({ loading: false, report: null, error: "" });
    setExportState({ loading: false, error: "" });
    setFilters(EMPTY_FILTERS);
    await fetchSession();
  }, [fetchSession]);

  const handleBuilderSort = useCallback((columnKey) => {
    setBuilderSort((prev) => {
      if (prev.key !== columnKey) {
        return { key: columnKey, direction: "asc" };
      }
      return { key: columnKey, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }, []);

  const handleExportXlsx = useCallback(async () => {
    setExportState({ loading: true, error: "" });
    try {
      const query = buildReportQuery(filters);
      const response = await fetch(`/api/dashboard/export?${query.toString()}`, { method: "GET" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.error || "Could not export report.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `crm-report-${Date.now()}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportState({ loading: false, error: "" });
    } catch (error) {
      setExportState({ loading: false, error: error?.message || "Could not export report." });
    }
  }, [filters]);

  const report = reportState.report;
  const options = report?.options || {};
  const officeOptions = options.officeScopes || sessionState.bootstrap.officeScopes || [];
  const monthOptions = useMemo(() => {
    const source = options.months || sessionState.bootstrap.months || [];
    return source.map((item) => ({
      value: item.key,
      label: item.office_name ? `${item.month_label} — ${item.office_name}` : item.month_label,
    }));
  }, [options.months, sessionState.bootstrap.months]);
  const builderDimensionOptions = options.builderDimensions || DEFAULT_BUILDER_DIMENSIONS;
  const builderMetricOptions = options.builderMetrics || DEFAULT_BUILDER_METRICS;
  const builderColumns = report?.builder?.columns || [];
  const sortedBuilderRows = useMemo(() => {
    if (report?.tableType !== "builder") {
      return [];
    }
    const rows = Array.isArray(report?.table) ? [...report.table] : [];
    const activeColumn = builderColumns.find((column) => column.key === builderSort.key);
    if (!activeColumn) {
      return rows;
    }
    rows.sort((left, right) => {
      const compare = compareBuilderValues(left[activeColumn.key], right[activeColumn.key], activeColumn.type);
      return builderSort.direction === "desc" ? -compare : compare;
    });
    return rows;
  }, [builderColumns, builderSort.direction, builderSort.key, report?.table, report?.tableType]);

  useEffect(() => {
    if (report?.tableType !== "builder") {
      if (builderSort.key) {
        setBuilderSort({ key: "", direction: "asc" });
      }
      return;
    }
    if (builderColumns.length && !builderColumns.some((column) => column.key === builderSort.key)) {
      setBuilderSort({ key: builderColumns[0].key, direction: "asc" });
    }
  }, [builderColumns, builderSort.key, report?.tableType]);

  if (sessionState.loading) {
    return (
      <main className={styles.unauthorizedPage}>
        <p>Loading dashboard...</p>
      </main>
    );
  }

  if (!sessionState.authenticated) {
    return (
      <main className={styles.loginPage}>
        <section className={`${styles.panel} ${styles.loginCard}`}>
          <h1 className={styles.title}>CRM Dashboard Login</h1>
          <p className={styles.sectionHint}>
            Log in with your Telegram account. Access permissions are shared with the Telegram bot.
          </p>
          {sessionState.auth.enabled ? (
            <TelegramLoginWidget botUsername={sessionState.auth.botUsername} onAuth={handleTelegramAuth} />
          ) : (
            <p className={styles.errorText}>
              Telegram login widget is unavailable. Check TELEGRAM_BOT_TOKEN and bot connectivity.
            </p>
          )}
          {sessionState.error ? <p className={styles.errorText}>{sessionState.error}</p> : null}
        </section>
      </main>
    );
  }

  if (!sessionState.authorized) {
    return (
      <main className={styles.unauthorizedPage}>
        <h1 className={styles.title}>CRM Dashboard</h1>
        <p className={styles.errorText}>Your Telegram account is logged in but not authorized for this dashboard.</p>
        <button type="button" onClick={handleLogout} className={`${styles.button} ${styles.buttonSecondary}`} style={{ width: 140 }}>
          Log out
        </button>
      </main>
    );
  }

  const needOfficeSelection = !filters.officeScope;
  const needReportSelection = !needOfficeSelection && !filters.reportMode;
  const isLast4Mode = filters.reportMode === "last4";

  return (
    <main className={styles.page}>
      <section className={`${styles.panel} ${styles.topBar}`}>
        <div>
          <h1 className={`${styles.title} ${styles.topBarTitle}`}>CRM Dashboard</h1>
          <p className={`${styles.subtitle} ${styles.topBarSubtitle}`}>
            Logged in as {sessionState.user?.username ? `@${sessionState.user.username}` : sessionState.user?.id}
          </p>
        </div>
        <button type="button" onClick={handleLogout} className={`${styles.button} ${styles.buttonSecondary}`}>
          Log out
        </button>
      </section>

      {needOfficeSelection ? (
        <section className={`${styles.panel} ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Step 1 — Select Office</h2>
          <p className={styles.sectionHint}>Choose your office first, then report type and filters will open.</p>
          <div className={styles.officeGrid}>
            {officeOptions.map((office) => {
              const officeTheme = officeThemeForName(office);
              return (
                <button
                  key={office}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      officeScope: office,
                      reportMode: "",
                      specificType: "builder",
                      monthKey: prev.monthKey || sessionState.bootstrap.defaultMonthKey || "",
                      date: "",
                      hour: "",
                      desk: "",
                      country: "",
                      brand: "",
                      campaign: "",
                      subCampaign: "",
                      placement: "",
                      status: "",
                      teamLeader: "",
                      agent: "",
                    }))
                  }
                  className={styles.officeCard}
                  style={officeTheme}
                >
                  <span className={styles.officeName}>{office}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {needReportSelection ? (
        <section className={`${styles.panel} ${styles.section} ${styles.stepCenter}`}>
          <h2 className={styles.sectionTitle}>Step 2 — Select Report</h2>
          <div className={styles.reportModeGrid}>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "monthly", specificType: "builder" }))}
              className={styles.reportModeCard}
            >
              <span className={styles.reportModeTitle}>{reportModeMeta("monthly").title}</span>
              <span className={styles.reportModeIcon}>{reportModeMeta("monthly").icon}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  reportMode: "last4",
                  specificType: "builder",
                  date: "",
                  hour: "",
                  country: "",
                  brand: "",
                  campaign: "",
                  subCampaign: "",
                  placement: "",
                  status: "",
                  groupBy: "agent",
                }))
              }
              className={styles.reportModeCard}
            >
              <span className={styles.reportModeTitle}>{reportModeMeta("last4").title}</span>
              <span className={styles.reportModeIcon}>{reportModeMeta("last4").icon}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  reportMode: "specific",
                  specificType: "builder",
                  rowDimensions: prev.rowDimensions?.length ? prev.rowDimensions : EMPTY_FILTERS.rowDimensions,
                  metricFields: prev.metricFields?.length ? prev.metricFields : EMPTY_FILTERS.metricFields,
                }))
              }
              className={styles.reportModeCard}
            >
              <span className={styles.reportModeTitle}>{reportModeMeta("specific").title}</span>
              <span className={styles.reportModeIcon}>{reportModeMeta("specific").icon}</span>
            </button>
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && !needReportSelection ? (
        <section className={`${styles.panel} ${styles.section} ${styles.sectionFancy}`}>
          <div className={styles.toolbar}>
            <h2 className={styles.sectionTitle}>Filters</h2>
            <div className={styles.pillRow}>
              {reportState.loading ? <span className={styles.loadingInline}>Updating filters...</span> : null}
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, reportMode: "" }))}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                Change Report Type
              </button>
            </div>
          </div>
          <div className={styles.filterRows}>
            <div className={styles.filterRow}>
              <SelectFilter
                label="Office"
                value={filters.officeScope}
                options={officeOptions.map((value) => ({ value, label: value }))}
                loading={reportState.loading}
                onChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    officeScope: value,
                    reportMode: "",
                    specificType: "builder",
                    date: "",
                    hour: "",
                    desk: "",
                    country: "",
                    brand: "",
                    campaign: "",
                    subCampaign: "",
                    placement: "",
                    status: "",
                    teamLeader: "",
                    agent: "",
                  }))
                }
              />
              {!isLast4Mode ? (
                <SelectFilter
                  label="Month"
                  value={filters.monthKey}
                  options={monthOptions}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, monthKey: value }))}
                  placeholder="Select month"
                />
              ) : null}
              {!isLast4Mode ? (
                <SelectFilter
                  label="Date"
                  value={filters.date}
                  options={asOptions(options.dates || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, date: value }))}
                />
              ) : null}
              {!isLast4Mode ? (
                <SelectFilter
                  label="Hour"
                  value={filters.hour}
                  options={asOptions(options.hours || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, hour: value }))}
                />
              ) : null}
            </div>

            <div className={styles.filterRow}>
              <SelectFilter
                label="Desk"
                value={filters.desk}
                options={asOptions(options.desks || [])}
                loading={reportState.loading}
                onChange={(value) => setFilters((prev) => ({ ...prev, desk: value, teamLeader: "", agent: "" }))}
              />
              <SelectFilter
                label="Team Leader"
                value={filters.teamLeader}
                options={asOptions(options.teamLeaders || [])}
                loading={reportState.loading}
                onChange={(value) => setFilters((prev) => ({ ...prev, teamLeader: value, agent: "" }))}
              />
              <SelectFilter
                label="Agent"
                value={filters.agent}
                options={asOptions(options.agents || [])}
                loading={reportState.loading}
                onChange={(value) => setFilters((prev) => ({ ...prev, agent: value }))}
              />
              {!isLast4Mode ? (
                <SelectFilter
                  label="Country"
                  value={filters.country}
                  options={asOptions(options.countries || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, country: value }))}
                />
              ) : null}
              {!isLast4Mode ? (
                <SelectFilter
                  label="Brand"
                  value={filters.brand}
                  options={asOptions(options.brands || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, brand: value }))}
                />
              ) : null}
              {!isLast4Mode ? (
                <SelectFilter
                  label="Campaign"
                  value={filters.campaign}
                  options={asOptions(options.campaigns || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, campaign: value }))}
                />
              ) : null}
            </div>

            {!isLast4Mode ? (
              <div className={styles.filterRow}>
                <SelectFilter
                  label="Sub Campaign"
                  value={filters.subCampaign}
                  options={asOptions(options.subCampaigns || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, subCampaign: value }))}
                />
                <SelectFilter
                  label="Placement"
                  value={filters.placement}
                  options={asOptions(options.placements || [])}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, placement: value }))}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && !needReportSelection && filters.reportMode === "specific" && filters.specificType === "builder" ? (
        <section className={`${styles.panel} ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Report Builder</h2>
          <ToggleGroup
            label="Row / Group Dimensions"
            items={builderDimensionOptions}
            selectedItems={filters.rowDimensions || []}
            onToggle={(key) =>
              setFilters((prev) => {
                const current = Array.isArray(prev.rowDimensions) ? prev.rowDimensions : [];
                const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
                if (!next.length) {
                  return prev;
                }
                return { ...prev, rowDimensions: next };
              })
            }
          />
          <ToggleGroup
            label="Metrics / Data Fields"
            items={builderMetricOptions}
            selectedItems={filters.metricFields || []}
            onToggle={(key) =>
              setFilters((prev) => {
                const current = Array.isArray(prev.metricFields) ? prev.metricFields : [];
                const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
                if (!next.length) {
                  return prev;
                }
                return { ...prev, metricFields: next };
              })
            }
          />
        </section>
      ) : null}

      {reportState.loading ? <LoadingReportIndicator /> : null}
      {reportState.error ? <p className={styles.errorText}>{reportState.error}</p> : null}
      {exportState.error ? <p className={styles.errorText}>{exportState.error}</p> : null}

      {report ? (
        <section className={styles.section} style={{ padding: 0 }}>
          <div className={styles.reportHeader}>
            <div>
              <h2 className={styles.reportHeaderTitle}>
                {report.month?.label || "Selected month"} — {report.month?.office_name || filters.officeScope}
              </h2>
              <p className={styles.reportHeaderSubtitle}>{report.tableTitle || "Report table"}</p>
            </div>
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={exportState.loading || reportState.loading}
              className={`${styles.button} ${styles.buttonSecondary}`}
            >
              {exportState.loading ? "Preparing XLSX..." : "Export XLSX"}
            </button>
          </div>
          <SummaryCards summary={report.summary || {}} />
          <StatusCards stats={report.stats || {}} />
          {report.tableType === "pivot" ? <PivotTable rows={report.table || []} summary={report.summary || {}} /> : null}
          {report.tableType === "last4_matrix" ? (
            <Last4MatrixTable rows={report.table || []} monthBlocks={report.monthBlocks || []} />
          ) : null}
          {report.tableType === "builder" ? (
            <section className={styles.section} style={{ padding: 0 }}>
              <h3 className={styles.sectionTitle}>Results Table</h3>
              <BuilderTable columns={builderColumns} rows={sortedBuilderRows} sortState={builderSort} onSort={handleBuilderSort} />
            </section>
          ) : null}
          {report.tableType && report.tableType !== "pivot" && report.tableType !== "last4_matrix" && report.tableType !== "builder" ? (
            <SimpleTable rows={report.table || []} />
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
