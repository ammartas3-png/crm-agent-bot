"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

const MULTI_VALUE_FILTER_KEYS = new Set([
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
]);

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

function benchmarkRateStyle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { background: "transparent", color: "#0f172a" };
  }
  if (number >= 110) {
    return { background: "#16a34a", color: "#ffffff" };
  }
  if (number >= 85) {
    return { background: "#65a30d", color: "#ffffff" };
  }
  if (number >= 60) {
    return { background: "#facc15", color: "#713f12" };
  }
  return { background: "#ef4444", color: "#ffffff" };
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

function MultiSelectFilter({
  label,
  values,
  options,
  onChange,
  placeholder = "All",
  disabled = false,
  loading = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedValues = Array.isArray(values) ? values : [];
  const selectedSet = new Set(selectedValues.map((item) => String(item)));

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleClickOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  const selectedLabel = useMemo(() => {
    if (!selectedValues.length) {
      return placeholder;
    }
    if (selectedValues.length === 1) {
      const matched = options.find((option) => option.value === selectedValues[0]);
      return matched?.label || selectedValues[0];
    }
    return `${selectedValues.length} selected`;
  }, [options, placeholder, selectedValues]);

  const orderedOptionValues = useMemo(() => options.map((option) => option.value), [options]);

  const toggleValue = useCallback(
    (nextValue) => {
      const valueKey = String(nextValue);
      const mutable = new Set(selectedSet);
      if (mutable.has(valueKey)) {
        mutable.delete(valueKey);
      } else {
        mutable.add(valueKey);
      }
      const ordered = orderedOptionValues.filter((value) => mutable.has(String(value)));
      onChange(ordered);
    },
    [onChange, orderedOptionValues, selectedSet],
  );

  return (
    <div className={styles.selectWrap} ref={rootRef}>
      <span className={styles.selectLabelRow}>
        <span className={styles.selectLabel}>{label}</span>
        {loading ? <span className={styles.selectSpinner} aria-hidden="true" /> : null}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`${styles.selectInput} ${styles.multiSelectButton}`}
      >
        <span className={styles.multiSelectText}>{selectedLabel}</span>
        <span className={styles.multiSelectCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className={styles.multiSelectMenu}>
          <button type="button" className={styles.multiSelectClear} onClick={() => onChange([])}>
            Clear
          </button>
          <div className={styles.multiSelectOptions}>
            {options.map((option) => {
              const checked = selectedSet.has(String(option.value));
              return (
                <label key={`${label}-${option.value}`} className={styles.multiSelectOption}>
                  <input type="checkbox" checked={checked} onChange={() => toggleValue(option.value)} />
                  <span>{option.label}</span>
                </label>
              );
            })}
            {!options.length ? <p className={styles.multiSelectEmpty}>No options</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function sanitizeFiltersWithOptions(sourceFilters = {}, options = {}) {
  const next = { ...sourceFilters };
  if (Array.isArray(options.officeScopes) && options.officeScopes.length) {
    const officeValues = Array.isArray(next.officeScope)
      ? next.officeScope
      : String(next.officeScope || "").trim()
        ? [String(next.officeScope || "").trim()]
        : [];
    const filteredOffices = officeValues.filter((value) => options.officeScopes.includes(value));
    next.officeScope = filteredOffices.length ? filteredOffices : [options.officeScopes[0]];
  }
  if (Array.isArray(options.months) && options.months.length) {
    const monthValues = Array.isArray(next.monthKey)
      ? next.monthKey
      : String(next.monthKey || "").trim()
        ? [String(next.monthKey || "").trim()]
        : [];
    const validMonthKeys = new Set(options.months.map((month) => month.key));
    const filteredMonths = monthValues.filter((value) => validMonthKeys.has(value));
    next.monthKey = filteredMonths.length ? filteredMonths : [options.months[0].key];
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
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter((value) => values.includes(value));
      continue;
    }
    if (next[key] && !values.includes(next[key])) {
      next[key] = MULTI_VALUE_FILTER_KEYS.has(key) ? [] : "";
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

function RowDimensionGroup({ label, items, selectedItems, selectedTotals, onToggleDimension, onToggleTotal }) {
  const selectedSet = new Set(selectedItems || []);
  const totalSet = new Set(selectedTotals || []);
  const lastSelectedKey = selectedItems?.[selectedItems.length - 1] || "";
  const selectedLabels = selectedItems
    .map((key) => items.find((item) => item.key === key)?.label || "")
    .filter(Boolean);
  return (
    <div className={styles.totalSwitchSection}>
      <div className={styles.chipTitle}>{label}</div>
      <div className={styles.chipList}>
        {items.map((item) => {
          const activeDimension = selectedSet.has(item.key);
          const totalEnabled = activeDimension && item.key !== lastSelectedKey;
          const totalActive = totalEnabled && totalSet.has(item.key);
          return (
            <div key={`row-dim-${item.key}`} className={styles.chipWithSwitch}>
              <button
                type="button"
                onClick={() => onToggleDimension(item.key)}
                className={`${styles.chip} ${activeDimension ? styles.chipActive : ""}`}
              >
                <span className={styles.chipInner}>
                  {activeDimension ? <span className={styles.chipCheck}>✓</span> : null}
                  {activeDimension ? <span className={styles.chipOrder}>{selectedItems.indexOf(item.key) + 1}</span> : null}
                  <span>{item.label}</span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`${item.label} total`}
                aria-pressed={totalActive}
                disabled={!totalEnabled}
                onClick={() => onToggleTotal(item.key)}
                className={`${styles.totalSwitch} ${
                  !totalEnabled ? styles.totalSwitchDisabled : totalActive ? styles.totalSwitchOn : styles.totalSwitchOff
                }`}
                title={
                  !totalEnabled
                    ? "Subtotal not available for last selected row"
                    : totalActive
                      ? `${item.label} subtotal enabled`
                      : `${item.label} subtotal disabled`
                }
              >
                <span
                  className={`${styles.totalSwitchThumb} ${totalActive ? styles.totalSwitchThumbOn : styles.totalSwitchThumbOff}`}
                />
              </button>
            </div>
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

function SingleChoiceChipGroup({ label, items, selectedKey, onSelect, noLabel = "No" }) {
  return (
    <div className={styles.chipSection}>
      <div className={styles.chipTitle}>{label}</div>
      <div className={styles.chipList}>
        <button
          type="button"
          onClick={() => onSelect("")}
          className={`${styles.chip} ${!selectedKey ? styles.chipActive : ""}`}
        >
          <span className={styles.chipInner}>
            {!selectedKey ? <span className={styles.chipCheck}>✓</span> : null}
            <span>{noLabel}</span>
          </span>
        </button>
        {items.map((item) => {
          const active = selectedKey === item.key;
          return (
            <button key={item.key} type="button" onClick={() => onSelect(item.key)} className={`${styles.chip} ${active ? styles.chipActive : ""}`}>
              <span className={styles.chipInner}>
                {active ? <span className={styles.chipCheck}>✓</span> : null}
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.orderPreview}>
        <div className={styles.orderLabel}>{label}</div>
        <div className={styles.orderValue}>{selectedKey ? items.find((item) => item.key === selectedKey)?.label || selectedKey : noLabel}</div>
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
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "-";
    }
    return formatNumber(value);
  }
  if (type === "percent") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "-";
    }
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

function BuilderTable({ columns = [], rows = [], sortState, onSort, builder = {} }) {
  const isColumnPivot =
    Boolean(builder?.columnDimension) &&
    Array.isArray(builder?.columnValues) &&
    builder.columnValues.length > 0 &&
    Array.isArray(builder?.columnMetrics) &&
    builder.columnMetrics.length > 0;
  const dimensionColumns = columns.filter((column) => column.kind === "dimension");
  const pivotMetricColumns = isColumnPivot
    ? builder.columnValues.flatMap((columnValue) =>
        builder.columnMetrics
          .map((metric) => columns.find((column) => column.key === `${builder.columnDimension}_${columnValue}__${metric.key}`))
          .filter(Boolean),
      )
    : [];
  const pivotMetricKeySet = new Set(pivotMetricColumns.map((column) => column.key));
  const pivotTailColumns = isColumnPivot
    ? columns.filter((column) => !pivotMetricKeySet.has(column.key) && column.kind !== "dimension")
    : [];
  const perGroupMetricCount = builder.columnMetrics?.length || 0;
  return (
    <div className={`${styles.panel} ${styles.tableCard}`} style={{ maxHeight: "70vh" }}>
      <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.tableSticky}`} style={{ minWidth: 900 }}>
        <thead>
          {isColumnPivot ? (
            <>
              <tr>
                {dimensionColumns.map((column) => {
                  const active = sortState.key === column.key;
                  const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={column.key} rowSpan={2} onClick={() => onSort(column.key)} style={{ cursor: "pointer" }}>
                      {column.label}
                      {suffix}
                    </th>
                  );
                })}
                {builder.columnValues.map((value) => (
                  <th key={`group-${value}`} colSpan={perGroupMetricCount} className={styles.tableGroupHeader}>
                    {value}
                  </th>
                ))}
                {pivotTailColumns.map((column) => {
                  const active = sortState.key === column.key;
                  const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={column.key} rowSpan={2} onClick={() => onSort(column.key)} style={{ cursor: "pointer" }}>
                      {column.label}
                      {suffix}
                    </th>
                  );
                })}
              </tr>
              <tr>
                {pivotMetricColumns.map((column) => {
                  const active = sortState.key === column.key;
                  const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                  const metricName = column.label.replace(/^[^\s]+\s+/, "");
                  return (
                    <th key={column.key} onClick={() => onSort(column.key)} style={{ cursor: "pointer" }} className={styles.tableSubHeader}>
                      {metricName}
                      {suffix}
                    </th>
                  );
                })}
              </tr>
            </>
          ) : (
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
          )}
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`builder-${index}`} className={row.__rowKind === "total" ? styles.tableTotalRow : ""}>
              {columns.map((column) => {
                const isReach = column.type === "percent" && column.key.toLowerCase().includes("reach");
                const isBenchmarkRate = column.key === "ftdBenchmarkRate" || column.key.endsWith("__ftdBenchmarkRate");
                const value = row[column.key];
                const benchmarkStyle = isBenchmarkRate ? benchmarkRateStyle(value) : null;
                return (
                  <td
                    key={`${index}-${column.key}`}
                    style={{
                      color: isBenchmarkRate ? benchmarkStyle.color : isReach ? reachColor(value) : "#0f172a",
                      background: isBenchmarkRate ? benchmarkStyle.background : undefined,
                      fontWeight: isBenchmarkRate ? 700 : undefined,
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
  { key: "leadShare", label: "Lead Share", type: "percent" },
  { key: "agentCount", label: "Number of Agents", type: "number" },
  { key: "avgLeadByAgent", label: "Avg Lead by Agent", type: "number" },
  { key: "avgLeadByAgentDaily", label: "Avg Lead by Agent Daily", type: "number" },
  { key: "ftd", label: "FTD", type: "number" },
  { key: "avgFtdByAgent", label: "Desk Avg FTD per Agent", type: "number" },
  { key: "avgFtdByAgentDaily", label: "Desk Avg FTD per Agent Daily", type: "number" },
  { key: "agentAvgFtdPerWorkedMonth", label: "Agent Avg FTD per Worked Month", type: "number" },
  { key: "avgFtdByDeskLongTerm", label: "Desk Avg FTD per Desk By Long Term", type: "number" },
  { key: "ftdBenchmarkRate", label: "Benchmark Rate", type: "percent" },
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

const DEFAULT_BUILDER_COLUMN_DIMENSIONS = [
  { key: "month", label: "Months", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "hour", label: "Hour", type: "hour" },
];

const EMPTY_FILTERS = {
  officeScope: [],
  reportMode: "",
  specificType: "builder",
  monthKey: [],
  date: [],
  hour: [],
  desk: [],
  country: [],
  brand: [],
  campaign: [],
  subCampaign: [],
  placement: [],
  status: [],
  teamLeader: [],
  agent: [],
  columnDimension: "",
  includeWorkTime: false,
  groupBy: "agent",
  rowDimensions: ["date", "desk", "teamLeader", "agent"],
  metricFields: [
    "leads",
    "leadShare",
    "agentCount",
    "avgLeadByAgent",
    "avgLeadByAgentDaily",
    "ftd",
    "avgFtdByAgent",
    "avgFtdByAgentDaily",
    "agentAvgFtdPerWorkedMonth",
    "ftdTarget",
    "ftdTargetReach",
    "cr",
    "crTarget",
    "crTargetReach",
  ],
  totalDimensions: [],
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
      const payload = await readApiPayload(response);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || "Could not load dashboard session.");
      }
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
      const officeScopeDefault = officeScopes.length === 1 ? [officeScopes[0]] : [];
      const monthDefault = payload.bootstrap?.defaultMonthKey ? [payload.bootstrap.defaultMonthKey] : [];
      setFilters((prev) => ({
        ...prev,
        officeScope: Array.isArray(prev.officeScope) && prev.officeScope.length ? prev.officeScope : officeScopeDefault,
        monthKey: Array.isArray(prev.monthKey) && prev.monthKey.length ? prev.monthKey : monthDefault,
      }));
      setAppliedFilters((prev) => ({
        ...prev,
        officeScope: Array.isArray(prev.officeScope) && prev.officeScope.length ? prev.officeScope : officeScopeDefault,
        monthKey: Array.isArray(prev.monthKey) && prev.monthKey.length ? prev.monthKey : monthDefault,
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
    if (
      !sessionState.authorized ||
      !Array.isArray(appliedFilters.officeScope) ||
      !appliedFilters.officeScope.length ||
      !appliedFilters.reportMode
    ) {
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
      const query = buildReportQuery(appliedFilters);
      const response = await fetch(`/api/dashboard/report?${query.toString()}`, { cache: "no-store" });
      const payload = await readApiPayload(response);
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
      setAppliedFilters((prev) => {
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

  const handleCascadingFilterChange = useCallback((key, value) => {
    const chain = ["desk", "brand", "agent", "country", "teamLeader", "campaign", "subCampaign", "placement"];
    setFilters((prev) => {
      const normalizedValue = MULTI_VALUE_FILTER_KEYS.has(key)
        ? (Array.isArray(value) ? value : [])
        : String(value || "").trim();
      const next = { ...prev, [key]: normalizedValue };
      const index = chain.indexOf(key);
      if (index >= 0) {
        for (let i = index + 1; i < chain.length; i += 1) {
          next[chain[i]] = MULTI_VALUE_FILTER_KEYS.has(chain[i]) ? [] : "";
        }
      }
      return next;
    });
  }, []);

  const handleApplyFilters = useCallback(() => {
    if (!Array.isArray(filters.officeScope) || !filters.officeScope.length || !filters.reportMode) {
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
  const draftQueryKey = useMemo(() => buildReportQuery(filters).toString(), [filters]);
  const appliedQueryKey = useMemo(() => buildReportQuery(appliedFilters).toString(), [appliedFilters]);
  const hasPendingChanges = draftQueryKey !== appliedQueryKey;
  const builderDimensionOptions = options.builderDimensions || DEFAULT_BUILDER_DIMENSIONS;
  const builderMetricOptions = options.builderMetrics || DEFAULT_BUILDER_METRICS;
  const builderColumnDimensionOptions = options.builderColumnDimensions || DEFAULT_BUILDER_COLUMN_DIMENSIONS;
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
    const selectedDimensions = Array.isArray(report?.builder?.selectedDimensions) ? report.builder.selectedDimensions : [];
    const selectedTotalDimensions = Array.isArray(report?.builder?.selectedTotalDimensions)
      ? report.builder.selectedTotalDimensions
      : [];
    const hasHierarchyTotals = rows.some((row) => row.__rowKind === "total") && selectedDimensions.length > 1;
    if (!hasHierarchyTotals) {
      rows.sort((left, right) => {
        const compare = compareBuilderValues(left[activeColumn.key], right[activeColumn.key], activeColumn.type);
        return builderSort.direction === "desc" ? -compare : compare;
      });
      return rows;
    }

    const detailRows = rows.filter((row) => row.__rowKind !== "total");
    const totalRows = rows.filter((row) => row.__rowKind === "total");
    const dimensionDepth = new Map(selectedDimensions.map((key, index) => [key, index]));
    const totalDimensionSet = new Set(selectedTotalDimensions);
    const normalizePiece = (value) => String(value || "-").trim().toLowerCase();
    const prefixKey = (pieces = []) => pieces.map(normalizePiece).join("::");
    const subtotalMap = new Map();
    for (const row of totalRows) {
      const dimensionKey = row.__totalDimension;
      const depth = dimensionDepth.get(dimensionKey);
      if (!dimensionKey || depth === undefined) {
        continue;
      }
      const pieces = [];
      for (let index = 0; index < depth; index += 1) {
        pieces.push(String(row[selectedDimensions[index]] || "-").trim() || "-");
      }
      const ownValue = String(row[dimensionKey] || "")
        .replace(/\s+total$/i, "")
        .trim();
      pieces.push(ownValue || "-");
      subtotalMap.set(`${dimensionKey}::${prefixKey(pieces)}`, row);
    }

    const aggregateMetric = (groupRows = []) => {
      if (activeColumn.type === "percent") {
        if (!groupRows.length) {
          return 0;
        }
        const total = groupRows.reduce((sum, row) => sum + Number(row[activeColumn.key] || 0), 0);
        return total / groupRows.length;
      }
      return groupRows.reduce((sum, row) => sum + Number(row[activeColumn.key] || 0), 0);
    };

    const sortRowsFlat = (groupRows = []) =>
      [...groupRows].sort((left, right) => {
        const compare = compareBuilderValues(left[activeColumn.key], right[activeColumn.key], activeColumn.type);
        return builderSort.direction === "desc" ? -compare : compare;
      });

    const sortGroups = (entries = [], dimensionKey, prefixPieces = []) =>
      [...entries].sort((leftEntry, rightEntry) => {
        const [leftValue, leftRows] = leftEntry;
        const [rightValue, rightRows] = rightEntry;
        const leftPrefix = [...prefixPieces, leftValue];
        const rightPrefix = [...prefixPieces, rightValue];
        const leftSubtotal = subtotalMap.get(`${dimensionKey}::${prefixKey(leftPrefix)}`);
        const rightSubtotal = subtotalMap.get(`${dimensionKey}::${prefixKey(rightPrefix)}`);

        let leftSortValue;
        let rightSortValue;
        if (activeColumn.kind === "metric" || activeColumn.type === "number" || activeColumn.type === "percent") {
          leftSortValue = leftSubtotal ? leftSubtotal[activeColumn.key] : aggregateMetric(leftRows);
          rightSortValue = rightSubtotal ? rightSubtotal[activeColumn.key] : aggregateMetric(rightRows);
        } else if (activeColumn.key === dimensionKey) {
          leftSortValue = leftValue;
          rightSortValue = rightValue;
        } else {
          leftSortValue = leftRows[0]?.[activeColumn.key];
          rightSortValue = rightRows[0]?.[activeColumn.key];
        }
        const compare = compareBuilderValues(leftSortValue, rightSortValue, activeColumn.type);
        return builderSort.direction === "desc" ? -compare : compare;
      });

    const orderHierarchical = (inputRows = [], depth = 0, prefixPieces = []) => {
      const dimensionKey = selectedDimensions[depth];
      if (!dimensionKey) {
        return sortRowsFlat(inputRows);
      }
      const grouped = new Map();
      for (const row of inputRows) {
        const groupValue = String(row[dimensionKey] || "-").trim() || "-";
        if (!grouped.has(groupValue)) {
          grouped.set(groupValue, []);
        }
        grouped.get(groupValue).push(row);
      }

      const sortedGroups = sortGroups([...grouped.entries()], dimensionKey, prefixPieces);
      const ordered = [];
      for (const [groupValue, groupRows] of sortedGroups) {
        const nextPrefix = [...prefixPieces, groupValue];
        if (totalDimensionSet.has(dimensionKey)) {
          const subtotalRow = subtotalMap.get(`${dimensionKey}::${prefixKey(nextPrefix)}`);
          if (subtotalRow) {
            ordered.push(subtotalRow);
          }
        }
        if (depth >= selectedDimensions.length - 1) {
          ordered.push(...sortRowsFlat(groupRows));
        } else {
          ordered.push(...orderHierarchical(groupRows, depth + 1, nextPrefix));
        }
      }
      return ordered;
    };

    return orderHierarchical(detailRows, 0, []);
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

  const needOfficeSelection = !Array.isArray(filters.officeScope) || filters.officeScope.length === 0;
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
                      officeScope: [office],
                      reportMode: "",
                      specificType: "builder",
                      monthKey:
                        Array.isArray(prev.monthKey) && prev.monthKey.length
                          ? prev.monthKey
                          : sessionState.bootstrap.defaultMonthKey
                            ? [sessionState.bootstrap.defaultMonthKey]
                            : [],
                      date: [],
                      hour: [],
                      desk: [],
                      country: [],
                      brand: [],
                      campaign: [],
                      subCampaign: [],
                      placement: [],
                      status: [],
                      teamLeader: [],
                      agent: [],
                      columnDimension: "",
                      includeWorkTime: false,
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
              onClick={() =>
                setFilters((prev) => ({ ...prev, reportMode: "monthly", specificType: "builder", includeWorkTime: false }))
              }
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
                  date: [],
                  hour: [],
                  country: [],
                  brand: [],
                  campaign: [],
                  subCampaign: [],
                  placement: [],
                  status: [],
                  columnDimension: "",
                  includeWorkTime: false,
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
                  columnDimension: prev.columnDimension || "",
                  includeWorkTime: Boolean(prev.includeWorkTime),
                  rowDimensions: prev.rowDimensions?.length ? prev.rowDimensions : EMPTY_FILTERS.rowDimensions,
                  metricFields: prev.metricFields?.length ? prev.metricFields : EMPTY_FILTERS.metricFields,
                  totalDimensions: Array.isArray(prev.totalDimensions)
                    ? prev.totalDimensions.filter((item) => {
                        const selectedDimensions = prev.rowDimensions?.length ? prev.rowDimensions : EMPTY_FILTERS.rowDimensions;
                        const lastSelected = selectedDimensions[selectedDimensions.length - 1] || "";
                        return selectedDimensions.includes(item) && item !== lastSelected;
                      })
                    : EMPTY_FILTERS.totalDimensions,
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
                onClick={handleApplyFilters}
                disabled={reportState.loading || !hasPendingChanges}
                className={`${styles.button} ${styles.buttonPrimary}`}
                style={reportState.loading || !hasPendingChanges ? { background: "#93c5fd", borderColor: "#93c5fd" } : undefined}
              >
                {reportState.loading ? "Loading..." : "Load Report"}
              </button>
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, reportMode: "" }))}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                Change Report Type
              </button>
            </div>
          </div>
          {hasPendingChanges ? (
            <p className={styles.inlineInfo}>
              You changed filters. Click <strong>Load Report</strong> to apply.
            </p>
          ) : null}
          <div className={styles.filterRows}>
            <div className={styles.filterRow}>
              <MultiSelectFilter
                label="Office"
                values={filters.officeScope}
                options={officeOptions.map((value) => ({ value, label: value }))}
                loading={reportState.loading}
                onChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    officeScope: value,
                    reportMode: "",
                    specificType: "builder",
                    date: [],
                    hour: [],
                    desk: [],
                    country: [],
                    brand: [],
                    campaign: [],
                    subCampaign: [],
                    placement: [],
                    status: [],
                    teamLeader: [],
                    agent: [],
                    columnDimension: "",
                  }))
                }
              />
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Month"
                  values={filters.monthKey}
                  options={monthOptions}
                  loading={reportState.loading}
                  onChange={(value) => setFilters((prev) => ({ ...prev, monthKey: value }))}
                  placeholder="Select month"
                />
              ) : null}
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Date"
                  values={filters.date}
                  options={asOptions(options.dates || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("date", value)}
                />
              ) : null}
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Hour"
                  values={filters.hour}
                  options={asOptions(options.hours || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("hour", value)}
                />
              ) : null}
            </div>

            <div className={styles.filterRow}>
              <MultiSelectFilter
                label="Desk"
                values={filters.desk}
                options={asOptions(options.desks || [])}
                loading={reportState.loading}
                onChange={(value) => handleCascadingFilterChange("desk", value)}
              />
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Brand"
                  values={filters.brand}
                  options={asOptions(options.brands || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("brand", value)}
                />
              ) : null}
              <MultiSelectFilter
                label="Agent"
                values={filters.agent}
                options={asOptions(options.agents || [])}
                loading={reportState.loading}
                onChange={(value) => handleCascadingFilterChange("agent", value)}
              />
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Country"
                  values={filters.country}
                  options={asOptions(options.countries || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("country", value)}
                />
              ) : null}
              <MultiSelectFilter
                label="Team Leader"
                values={filters.teamLeader}
                options={asOptions(options.teamLeaders || [])}
                loading={reportState.loading}
                onChange={(value) => handleCascadingFilterChange("teamLeader", value)}
              />
              {!isLast4Mode ? (
                <MultiSelectFilter
                  label="Campaign"
                  values={filters.campaign}
                  options={asOptions(options.campaigns || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("campaign", value)}
                />
              ) : null}
            </div>

            {!isLast4Mode ? (
              <div className={styles.filterRow}>
                <MultiSelectFilter
                  label="Sub Campaign"
                  values={filters.subCampaign}
                  options={asOptions(options.subCampaigns || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("subCampaign", value)}
                />
                <MultiSelectFilter
                  label="Placement"
                  values={filters.placement}
                  options={asOptions(options.placements || [])}
                  loading={reportState.loading}
                  onChange={(value) => handleCascadingFilterChange("placement", value)}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && !needReportSelection && filters.reportMode === "specific" && filters.specificType === "builder" ? (
        <section className={`${styles.panel} ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Report Builder</h2>
          <SingleChoiceChipGroup
            label="Column"
            items={builderColumnDimensionOptions}
            selectedKey={filters.columnDimension}
            onSelect={(value) => setFilters((prev) => ({ ...prev, columnDimension: value }))}
            noLabel="No"
          />
          <RowDimensionGroup
            label="Row / Group Dimensions"
            items={builderDimensionOptions}
            selectedItems={filters.rowDimensions || []}
            selectedTotals={filters.totalDimensions || []}
            onToggleDimension={(key) =>
              setFilters((prev) => {
                const current = Array.isArray(prev.rowDimensions) ? prev.rowDimensions : [];
                const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
                if (!next.length) {
                  return prev;
                }
                const lastSelected = next[next.length - 1];
                const nextTotals = Array.isArray(prev.totalDimensions)
                  ? prev.totalDimensions.filter((item) => next.includes(item) && item !== lastSelected)
                  : [];
                return { ...prev, rowDimensions: next, totalDimensions: nextTotals };
              })
            }
            onToggleTotal={(key) =>
              setFilters((prev) => {
                const selectedDimensions = Array.isArray(prev.rowDimensions) ? prev.rowDimensions : [];
                const lastSelected = selectedDimensions[selectedDimensions.length - 1] || "";
                if (!selectedDimensions.includes(key) || key === lastSelected) {
                  return prev;
                }
                const currentTotals = Array.isArray(prev.totalDimensions) ? prev.totalDimensions : [];
                const nextTotals = currentTotals.includes(key)
                  ? currentTotals.filter((item) => item !== key)
                  : [...currentTotals, key];
                return { ...prev, totalDimensions: nextTotals };
              })
            }
          />
          <div className={styles.workTimeToggleRow}>
            <span className={styles.workTimeToggleLabel}>Work Time</span>
            <button
              type="button"
              className={`${styles.workTimeToggle} ${filters.includeWorkTime ? styles.workTimeToggleOn : ""}`}
              onClick={() => setFilters((prev) => ({ ...prev, includeWorkTime: !prev.includeWorkTime }))}
            >
              <span className={styles.workTimeToggleThumb} />
              <span>{filters.includeWorkTime ? "ON" : "OFF"}</span>
            </button>
          </div>
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
                {report.month?.label || "Selected month"} —{" "}
                {report.month?.office_name ||
                  (Array.isArray(appliedFilters.officeScope) ? appliedFilters.officeScope.join(", ") : appliedFilters.officeScope)}
              </h2>
              <p className={styles.reportHeaderSubtitle}>{report.tableTitle || "Report table"}</p>
            </div>
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={exportState.loading || reportState.loading || hasPendingChanges}
              className={`${styles.button} ${styles.buttonSecondary}`}
            >
              {exportState.loading ? "Preparing XLSX..." : hasPendingChanges ? "Load report to export" : "Export XLSX"}
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
              <BuilderTable
                columns={builderColumns}
                rows={sortedBuilderRows}
                sortState={builderSort}
                onSort={handleBuilderSort}
                builder={report?.builder || {}}
              />
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
