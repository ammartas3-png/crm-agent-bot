"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function SelectFilter({ label, value, options, onChange, placeholder = "All", disabled = false }) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 145, flex: 1 }}>
      <span style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          padding: "8px 10px",
          background: disabled ? "#f8fafc" : "#fff",
          color: "#0f172a",
          fontSize: 13,
        }}
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
    ["desk", options.desks || []],
    ["country", options.countries || []],
    ["brand", options.brands || []],
    ["campaign", options.campaigns || []],
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
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => {
          const active = selectedItems.includes(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onToggle(item.key)}
              style={{
                border: active ? "1px solid #2563eb" : "1px solid #cbd5e1",
                borderRadius: 999,
                padding: "6px 10px",
                background: active ? "#eff6ff" : "#fff",
                color: active ? "#1d4ed8" : "#0f172a",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          );
        })}
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
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
      {items.map((item) => (
        <div key={item.label} style={{ border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff", padding: 10 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{item.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: item.color || "#0f172a" }}>{item.value}</div>
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
    <div
      style={{
        border: "1px solid #dbe3ee",
        borderRadius: 10,
        background: "#fff",
        padding: 10,
        display: "grid",
        gap: 6,
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      }}
    >
      {items.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
          <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({ rows = [] }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {["Group", "Leads", "FTD", "FTD Target", "FTD Target Reach", "CR", "CR Target", "CR Target Reach", "Selfs", "Late FTD"].map(
              (header) => (
                <th key={header} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.monthKey || row.label}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.label}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.totalLeads)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.totalFtd)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.ftdTarget)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", color: reachColor(row.ftdTargetReach) }}>
                {formatPercent(row.ftdTargetReach)}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(row.cr)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(row.crTarget)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", color: reachColor(row.crTargetReach) }}>
                {formatPercent(row.crTargetReach)}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.selfs)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.lateFtd)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={10} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function PivotTable({ rows = [], summary = {} }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1150 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
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
              <th key={header} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.desk}-${row.teamLeader}-${row.agent}`}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.desk}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.teamLeader}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.agent}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.totalLeads)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.totalFtd)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.selfs)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.lateFtd)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(row.cr)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(row.crTarget)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", color: reachColor(row.crTargetReach) }}>
                {formatPercent(row.crTargetReach)}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(row.ftdTarget)}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", color: reachColor(row.ftdTargetReach) }}>
                {formatPercent(row.ftdTargetReach)}
              </td>
            </tr>
          ))}
          <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>Grand total</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }} />
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }} />
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatNumber(summary.totalLeads)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatNumber(summary.totalFtd)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatNumber(summary.selfs)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatNumber(summary.lateFtd)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatPercent(summary.cr)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatPercent(summary.crTarget)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee", color: reachColor(summary.crTargetReach) }}>
              {formatPercent(summary.crTargetReach)}
            </td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee" }}>{formatNumber(summary.ftdTarget)}</td>
            <td style={{ padding: "9px 12px", borderTop: "1px solid #dbe3ee", color: reachColor(summary.ftdTargetReach) }}>
              {formatPercent(summary.ftdTargetReach)}
            </td>
          </tr>
        </tbody>
      </table>
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
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1880 }}>
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
    <section
      style={{
        border: "1px solid #dbe3ee",
        borderRadius: 10,
        background: "#fff",
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <style>{`
        @keyframes crmBarMove {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
        @keyframes crmBounce {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-4px) rotate(-6deg); }
        }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#1e293b" }}>
        <span style={{ animation: "crmBounce 0.7s ease-in-out infinite", display: "inline-block" }}>🤖</span>
        <span>Building your report...</span>
      </div>
      <div
        style={{
          position: "relative",
          height: 12,
          borderRadius: 999,
          overflow: "hidden",
          background: "linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "35%",
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, #38bdf8 0%, #2563eb 60%, #1d4ed8 100%)",
            animation: "crmBarMove 1.2s linear infinite",
            boxShadow: "0 0 12px rgba(37, 99, 235, 0.45)",
          }}
        />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Please wait, data is being fetched and calculated.</p>
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
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff", maxHeight: "70vh" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {columns.map((column) => {
              const active = sortState.key === column.key;
              const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  key={column.key}
                  onClick={() => onSort(column.key)}
                  style={{
                    textAlign: "left",
                    padding: "9px 12px",
                    borderBottom: "1px solid #dbe3ee",
                    borderTop: "1px solid #dbe3ee",
                    fontSize: 12,
                    cursor: "pointer",
                    position: "sticky",
                    top: 0,
                    background: "#f8fafc",
                    zIndex: 2,
                    whiteSpace: "nowrap",
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
                      padding: "8px 12px",
                      borderBottom: "1px solid #eef2f7",
                      color: isReach ? reachColor(value) : "#0f172a",
                      whiteSpace: "nowrap",
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
              <td colSpan={columns.length || 1} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No data found for current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const DEFAULT_BUILDER_DIMENSIONS = [
  { key: "date", label: "Date", type: "date" },
  { key: "hour", label: "Hour", type: "hour" },
  { key: "desk", label: "Desk", type: "text" },
  { key: "teamLeader", label: "Team Leader", type: "text" },
  { key: "agent", label: "Agent", type: "text" },
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
  desk: "",
  country: "",
  brand: "",
  campaign: "",
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
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
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
    if (!sessionState.authorized || !appliedFilters.officeScope || !appliedFilters.reportMode) {
      setReportState((prev) => ({ ...prev, report: null, loading: false }));
      return;
    }
    setReportState((prev) => ({ ...prev, loading: true, error: "" }));
    setExportState((prev) => ({ ...prev, error: "" }));
    try {
      const query = buildReportQuery(appliedFilters);
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
      const sanitizedApplied = sanitizeFiltersWithOptions(appliedFilters, options);
      const sanitizedKey = buildReportQuery(sanitizedApplied).toString();
      const appliedKey = buildReportQuery(appliedFilters).toString();
      if (sanitizedKey !== appliedKey) {
        setAppliedFilters(sanitizedApplied);
      }
      setFilters((prev) => {
        const prevKey = buildReportQuery(prev).toString();
        if (prevKey !== appliedKey) {
          return prev;
        }
        return sanitizedApplied;
      });
    } catch (error) {
      setReportState({
        loading: false,
        report: null,
        error: error?.message || "Could not load report.",
      });
    }
  }, [appliedFilters, sessionState.authorized]);

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
    setAppliedFilters(EMPTY_FILTERS);
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

  const handleApplyFilters = useCallback(() => {
    if (!filters.officeScope || !filters.reportMode) {
      return;
    }
    setAppliedFilters({ ...filters });
  }, [filters]);

  const handleExportXlsx = useCallback(async () => {
    setExportState({ loading: true, error: "" });
    try {
      const query = buildReportQuery(appliedFilters);
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
  }, [appliedFilters]);

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
  const draftQueryKey = useMemo(() => buildReportQuery(filters).toString(), [filters]);
  const appliedQueryKey = useMemo(() => buildReportQuery(appliedFilters).toString(), [appliedFilters]);
  const hasPendingChanges = draftQueryKey !== appliedQueryKey;
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
      <main style={{ fontFamily: "Arial, sans-serif", padding: 24 }}>
        <p>Loading dashboard...</p>
      </main>
    );
  }

  if (!sessionState.authenticated) {
    return (
      <main
        style={{
          minHeight: "100vh",
          padding: 24,
          fontFamily: "Arial, sans-serif",
          background: "#f1f5f9",
          display: "grid",
          placeItems: "center",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: 560,
            background: "#fff",
            border: "1px solid #dbe3ee",
            borderRadius: 12,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24 }}>CRM Dashboard Login</h1>
          <p style={{ margin: 0, color: "#475569" }}>
            Log in with your Telegram account. Access permissions are shared with the Telegram bot.
          </p>
          {sessionState.auth.enabled ? (
            <TelegramLoginWidget botUsername={sessionState.auth.botUsername} onAuth={handleTelegramAuth} />
          ) : (
            <p style={{ margin: 0, color: "#b91c1c" }}>
              Telegram login widget is unavailable. Check TELEGRAM_BOT_TOKEN and bot connectivity.
            </p>
          )}
          {sessionState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{sessionState.error}</p> : null}
        </section>
      </main>
    );
  }

  if (!sessionState.authorized) {
    return (
      <main style={{ fontFamily: "Arial, sans-serif", padding: 24, display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>CRM Dashboard</h1>
        <p style={{ margin: 0, color: "#b91c1c" }}>Your Telegram account is logged in but not authorized for this dashboard.</p>
        <button
          type="button"
          onClick={handleLogout}
          style={{ width: 140, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
        >
          Log out
        </button>
      </main>
    );
  }

  const needOfficeSelection = !filters.officeScope;
  const needReportSelection = !needOfficeSelection && !filters.reportMode;

  return (
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "Arial, sans-serif",
        padding: 16,
        background: "#f1f5f9",
        color: "#0f172a",
        display: "grid",
        gap: 14,
      }}
    >
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          background: "#fff",
          border: "1px solid #dbe3ee",
          borderRadius: 10,
          padding: 14,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>CRM Dashboard</h1>
          <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
            Logged in as {sessionState.user?.username ? `@${sessionState.user.username}` : sessionState.user?.id}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}
        >
          Log out
        </button>
      </section>

      {needOfficeSelection ? (
        <section style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 10, padding: 16, display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Step 1 — Select Office</h2>
          <p style={{ margin: 0, color: "#64748b" }}>Choose your office first, then report type and filters will open.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {officeOptions.map((office) => (
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
                    desk: "",
                    country: "",
                    brand: "",
                    campaign: "",
                    placement: "",
                    status: "",
                    teamLeader: "",
                    agent: "",
                  }))
                }
                style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
              >
                {office}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {needReportSelection ? (
        <section style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 10, padding: 16, display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Step 2 — Select Report</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "monthly", specificType: "builder" }))}
              style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
            >
              Monthly Report
            </button>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "last4", specificType: "builder" }))}
              style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
            >
              Last 4 Months Report
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
              style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
            >
              Specific Reports
            </button>
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && !needReportSelection ? (
        <section style={{ border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff", padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Filters</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={reportState.loading || !hasPendingChanges}
                style={{
                  border: "1px solid #2563eb",
                  borderRadius: 8,
                  padding: "7px 12px",
                  background: reportState.loading || !hasPendingChanges ? "#dbeafe" : "#2563eb",
                  color: reportState.loading || !hasPendingChanges ? "#1e3a8a" : "#fff",
                  cursor: reportState.loading || !hasPendingChanges ? "default" : "pointer",
                  fontWeight: 700,
                }}
              >
                {reportState.loading ? "Loading..." : "Load Report"}
              </button>
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, reportMode: "" }))}
                style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", background: "#fff", cursor: "pointer" }}
              >
                Change Report Type
              </button>
            </div>
          </div>
          {hasPendingChanges ? (
            <p style={{ margin: 0, color: "#1d4ed8", fontSize: 12 }}>
              You changed filters. Click <strong>Load Report</strong> to apply.
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <SelectFilter
              label="Office"
              value={filters.officeScope}
              options={officeOptions.map((value) => ({ value, label: value }))}
              onChange={(value) =>
                setFilters((prev) => ({
                  ...prev,
                  officeScope: value,
                  reportMode: "",
                    specificType: "builder",
                  desk: "",
                  country: "",
                  brand: "",
                  campaign: "",
                  placement: "",
                  status: "",
                  teamLeader: "",
                  agent: "",
                }))
              }
            />
            {filters.reportMode !== "last4" ? (
              <SelectFilter
                label="Month"
                value={filters.monthKey}
                options={monthOptions}
                onChange={(value) => setFilters((prev) => ({ ...prev, monthKey: value }))}
                placeholder="Select month"
              />
            ) : null}
            {filters.reportMode === "specific" ? (
              <SelectFilter
                label="Specific Report"
                value={filters.specificType}
                options={[
                  { value: "builder", label: "Custom Report Builder" },
                  { value: "hourly", label: "By Hourly FTD" },
                  { value: "best_agents", label: "Best Agents" },
                ]}
                onChange={(value) => setFilters((prev) => ({ ...prev, specificType: value }))}
                placeholder="Select specific report"
              />
            ) : null}
            <SelectFilter
              label="Desk"
              value={filters.desk}
              options={asOptions(options.desks || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, desk: value, teamLeader: "", agent: "" }))}
            />
            <SelectFilter
              label="Team Leader"
              value={filters.teamLeader}
              options={asOptions(options.teamLeaders || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, teamLeader: value, agent: "" }))}
            />
            <SelectFilter
              label="Agent"
              value={filters.agent}
              options={asOptions(options.agents || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, agent: value }))}
            />
            <SelectFilter
              label="Country"
              value={filters.country}
              options={asOptions(options.countries || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, country: value }))}
            />
            <SelectFilter
              label="Brand"
              value={filters.brand}
              options={asOptions(options.brands || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, brand: value }))}
            />
            <SelectFilter
              label="Campaign"
              value={filters.campaign}
              options={asOptions(options.campaigns || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, campaign: value }))}
            />
            <SelectFilter
              label="Placement"
              value={filters.placement}
              options={asOptions(options.placements || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, placement: value }))}
            />
            <SelectFilter
              label="Working Status"
              value={filters.status}
              options={asOptions(options.statuses || [])}
              onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            />
            <SelectFilter
              label="Table Group"
              value={filters.groupBy}
              options={[
                { value: "agent", label: "Agent" },
                { value: "teamLeader", label: "Team Leader" },
                { value: "desk", label: "Desk" },
                { value: "country", label: "Country" },
                { value: "brand", label: "Brand" },
                { value: "campaign", label: "Campaign" },
                { value: "placement", label: "Placement" },
              ]}
              onChange={(value) => setFilters((prev) => ({ ...prev, groupBy: value }))}
              disabled={filters.reportMode === "last4"}
            />
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && !needReportSelection && filters.reportMode === "specific" && filters.specificType === "builder" ? (
        <section style={{ border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff", padding: 12, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Report Builder</h2>
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
      {reportState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{reportState.error}</p> : null}
      {exportState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{exportState.error}</p> : null}

      {report ? (
        <section style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                {report.month?.label || "Selected month"} — {report.month?.office_name || appliedFilters.officeScope}
              </h2>
              <p style={{ margin: 0, color: "#64748b" }}>{report.tableTitle || "Report table"}</p>
            </div>
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={exportState.loading || hasPendingChanges}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 12px",
                background: exportState.loading || hasPendingChanges ? "#f8fafc" : "#fff",
                color: "#0f172a",
                cursor: exportState.loading || hasPendingChanges ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {exportState.loading ? "Preparing XLSX..." : hasPendingChanges ? "Apply changes to export" : "Export XLSX"}
            </button>
          </div>
          <SummaryCards summary={report.summary || {}} />
          <StatusCards stats={report.stats || {}} />
          {report.tableType === "pivot" ? <PivotTable rows={report.table || []} summary={report.summary || {}} /> : null}
          {report.tableType === "last4_matrix" ? (
            <Last4MatrixTable rows={report.table || []} monthBlocks={report.monthBlocks || []} />
          ) : null}
          {report.tableType === "builder" ? (
            <section style={{ display: "grid", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Results Table</h3>
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
