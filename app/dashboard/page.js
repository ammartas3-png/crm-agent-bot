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

function formatElapsedMs(value) {
  const totalMs = Math.max(0, Number(value || 0));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor((totalMs % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${millis}`;
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

function reachCellStyle(value) {
  const number = Number(value || 0);
  if (number >= 100) {
    return { background: "#dcfce7", color: "#166534" };
  }
  return { background: "#fee2e2", color: "#b91c1c" };
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

function workingStatusStyle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "working") {
    return { background: "#16a34a", color: "#ffffff" };
  }
  if (normalized === "not working" || normalized === "not_working" || normalized) {
    return { background: "#ef4444", color: "#ffffff" };
  }
  return { background: "transparent", color: "#0f172a" };
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

function useResizableColumns({ minWidth = 84 } = {}) {
  const [columnWidths, setColumnWidths] = useState({});

  const startResize = useCallback(
    (event, columnKey) => {
      if (!columnKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const headerCell = event.currentTarget?.closest?.("th");
      const startX = Number(event.clientX || 0);
      const currentWidth = Number(columnWidths[columnKey] || 0);
      const startWidth = currentWidth > 0 ? currentWidth : Math.max(minWidth, Number(headerCell?.offsetWidth || minWidth));

      const onMouseMove = (moveEvent) => {
        const delta = Number(moveEvent.clientX || 0) - startX;
        const nextWidth = Math.max(minWidth, startWidth + delta);
        setColumnWidths((prev) => {
          if (prev[columnKey] === nextWidth) {
            return prev;
          }
          return {
            ...prev,
            [columnKey]: nextWidth,
          };
        });
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [columnWidths, minWidth],
  );

  const widthStyle = useCallback(
    (columnKey, extra = {}) => {
      const width = Number(columnWidths[columnKey] || 0);
      if (!width) {
        return extra;
      }
      return {
        ...extra,
        width,
        minWidth: width,
      };
    },
    [columnWidths],
  );

  return { startResize, widthStyle };
}

function ColumnResizeHandle({ columnKey = "", onResizeStart }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize column"
      className={styles.columnResizeHandle}
      onMouseDown={(event) => onResizeStart?.(event, columnKey)}
      onClick={(event) => event.stopPropagation()}
    />
  );
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
  const [searchText, setSearchText] = useState("");
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

  useEffect(() => {
    if (!open) {
      setSearchText("");
    }
  }, [open]);

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
  const filteredOptions = useMemo(() => {
    const needle = String(searchText || "").trim().toLocaleLowerCase("en-US");
    if (!needle) {
      return options;
    }
    return options.filter((option) => {
      const labelMatch = String(option.label || "")
        .toLocaleLowerCase("en-US")
        .includes(needle);
      if (labelMatch) {
        return true;
      }
      return String(option.value || "")
        .toLocaleLowerCase("en-US")
        .includes(needle);
    });
  }, [options, searchText]);

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
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className={styles.multiSelectSearch}
          />
          <div className={styles.multiSelectOptions}>
            {filteredOptions.map((option) => {
              const checked = selectedSet.has(String(option.value));
              return (
                <label key={`${label}-${option.value}`} className={styles.multiSelectOption}>
                  <input type="checkbox" checked={checked} onChange={() => toggleValue(option.value)} />
                  <span>{option.label}</span>
                </label>
              );
            })}
            {!filteredOptions.length ? (
              <p className={styles.multiSelectEmpty}>{searchText ? "No matching options" : "No options"}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateRangeFilter({ label, values, options, onChange, disabled = false, loading = false }) {
  const availableDates = useMemo(() => {
    const unique = new Set();
    for (const option of options || []) {
      const value = String(option?.value || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        unique.add(value);
      }
    }
    return [...unique].sort((left, right) => left.localeCompare(right));
  }, [options]);

  const selectedDates = useMemo(() => {
    const selected = Array.isArray(values) ? values : [];
    const availableSet = new Set(availableDates);
    return selected
      .map((item) => String(item || "").trim())
      .filter((item) => availableSet.has(item))
      .sort((left, right) => left.localeCompare(right));
  }, [availableDates, values]);

  const selectedFrom = selectedDates[0] || "";
  const selectedTo = selectedDates[selectedDates.length - 1] || "";
  const [fromDate, setFromDate] = useState(selectedFrom);
  const [toDate, setToDate] = useState(selectedTo);

  useEffect(() => {
    setFromDate(selectedFrom);
    setToDate(selectedTo);
  }, [selectedFrom, selectedTo]);

  const applyRange = useCallback(
    (nextFrom, nextTo) => {
      if (!availableDates.length) {
        onChange([]);
        return;
      }
      if (!nextFrom && !nextTo) {
        onChange([]);
        return;
      }
      let start = nextFrom || nextTo;
      let end = nextTo || nextFrom;
      if (start > end) {
        [start, end] = [end, start];
      }
      const ranged = availableDates.filter((date) => date >= start && date <= end);
      onChange(ranged);
    },
    [availableDates, onChange],
  );

  const summaryText = useMemo(() => {
    if (!selectedDates.length) {
      return "All";
    }
    if (selectedFrom && selectedTo) {
      return `${selectedFrom} → ${selectedTo}`;
    }
    return selectedFrom || selectedTo;
  }, [selectedDates.length, selectedFrom, selectedTo]);

  return (
    <div className={`${styles.selectWrap} ${styles.dateRangeWrap}`}>
      <span className={styles.selectLabelRow}>
        <span className={styles.selectLabel}>{label}</span>
        {loading ? <span className={styles.selectSpinner} aria-hidden="true" /> : null}
      </span>
      <div className={styles.dateRangeInputs}>
        <input
          type="date"
          value={fromDate}
          disabled={disabled || !availableDates.length}
          min={availableDates[0] || ""}
          max={availableDates[availableDates.length - 1] || ""}
          onChange={(event) => {
            const nextValue = String(event.target.value || "");
            setFromDate(nextValue);
            applyRange(nextValue, toDate);
          }}
          className={`${styles.selectInput} ${styles.dateRangeInput}`}
        />
        <input
          type="date"
          value={toDate}
          disabled={disabled || !availableDates.length}
          min={availableDates[0] || ""}
          max={availableDates[availableDates.length - 1] || ""}
          onChange={(event) => {
            const nextValue = String(event.target.value || "");
            setToDate(nextValue);
            applyRange(fromDate, nextValue);
          }}
          className={`${styles.selectInput} ${styles.dateRangeInput}`}
        />
      </div>
      <div className={styles.dateRangeFooter}>
        <span className={styles.dateRangeSummary}>{summaryText}</span>
        <button
          type="button"
          disabled={disabled || !selectedDates.length}
          onClick={() => {
            setFromDate("");
            setToDate("");
            onChange([]);
          }}
          className={styles.dateRangeClear}
        >
          Clear
        </button>
      </div>
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
    if (rawText.includes("__next_error__") || rawText.toLowerCase().includes("<!doctype html")) {
      return {
        ok: false,
        error: "server_error_html_response",
        message: "Server error occurred while loading report. Please retry. If it continues, reduce selected filters.",
      };
    }
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
    next.officeScope = filteredOffices.length ? [filteredOffices[0]] : [options.officeScopes[0]];
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

function ToggleGroup({ label, items, selectedItems, onToggle, locked = false, activeClassName = "" }) {
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
              disabled={locked}
              onClick={() => onToggle(item.key)}
              className={`${styles.chip} ${active ? styles.chipActive : ""} ${active ? activeClassName : ""}`}
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

function RowDimensionGroup({
  label,
  items,
  selectedItems,
  selectedTotals,
  onToggleDimension,
  onToggleTotal,
  locked = false,
  activeClassName = "",
}) {
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
                disabled={locked}
                onClick={() => onToggleDimension(item.key)}
                className={`${styles.chip} ${activeDimension ? styles.chipActive : ""} ${activeDimension ? activeClassName : ""}`}
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
                disabled={!totalEnabled || locked}
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

function SingleChoiceChipGroup({
  label,
  items,
  selectedKey,
  onSelect,
  noLabel = "No",
  grandTotalLabel = "",
  grandTotalEnabled = false,
  onToggleGrandTotal = null,
  locked = false,
  activeClassName = "",
}) {
  const canToggleGrandTotal = Boolean(selectedKey && onToggleGrandTotal && !locked);
  return (
    <div className={styles.chipSection}>
      <div className={styles.chipTitle}>{label}</div>
      <div className={styles.chipList}>
        <button
          type="button"
          disabled={locked}
          onClick={() => onSelect("")}
          className={`${styles.chip} ${!selectedKey ? styles.chipActive : ""} ${!selectedKey ? activeClassName : ""}`}
        >
          <span className={styles.chipInner}>
            {!selectedKey ? <span className={styles.chipCheck}>✓</span> : null}
            <span>{noLabel}</span>
          </span>
        </button>
        {items.map((item) => {
          const active = selectedKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              disabled={locked}
              onClick={() => onSelect(item.key)}
              className={`${styles.chip} ${active ? styles.chipActive : ""} ${active ? activeClassName : ""}`}
            >
              <span className={styles.chipInner}>
                {active ? <span className={styles.chipCheck}>✓</span> : null}
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}
        {onToggleGrandTotal ? (
          <div className={styles.chipWithSwitch}>
            <button
              type="button"
              onClick={() => onToggleGrandTotal(!grandTotalEnabled)}
              disabled={!canToggleGrandTotal}
              className={`${styles.chip} ${grandTotalEnabled ? styles.chipActive : ""} ${grandTotalEnabled ? activeClassName : ""}`}
              title={canToggleGrandTotal ? "Show/Hide column grand total" : "Select a column first"}
            >
              <span className={styles.chipInner}>
                {grandTotalEnabled ? <span className={styles.chipCheck}>✓</span> : null}
                <span>{grandTotalLabel || "Grand Total"}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={grandTotalLabel || "Grand Total"}
              aria-pressed={grandTotalEnabled}
              disabled={!canToggleGrandTotal}
              onClick={() => onToggleGrandTotal(!grandTotalEnabled)}
              className={`${styles.totalSwitch} ${
                !canToggleGrandTotal ? styles.totalSwitchDisabled : grandTotalEnabled ? styles.totalSwitchOn : styles.totalSwitchOff
              }`}
              title={canToggleGrandTotal ? "Show/Hide column grand total" : "Select a column first"}
            >
              <span
                className={`${styles.totalSwitchThumb} ${
                  grandTotalEnabled ? styles.totalSwitchThumbOn : styles.totalSwitchThumbOff
                }`}
              />
            </button>
          </div>
        ) : null}
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
  const columns = [
    { key: "label", header: "Group" },
    { key: "totalLeads", header: "Leads" },
    { key: "totalFtd", header: "FTD" },
    { key: "ftdTarget", header: "FTD Target" },
    { key: "ftdTargetReach", header: "FTD Target Reach", type: "percentReach" },
    { key: "cr", header: "CR", type: "percent" },
    { key: "crTarget", header: "CR Target", type: "percent" },
    { key: "crTargetReach", header: "CR Target Reach", type: "percentReach" },
    { key: "selfs", header: "Selfs" },
    { key: "lateFtd", header: "Late FTD" },
  ];
  const [hoveredColumnKey, setHoveredColumnKey] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const { startResize, widthStyle } = useResizableColumns();
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.tableSticky}`} onMouseLeave={() => setHoveredColumnKey("")}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                onMouseEnter={() => setHoveredColumnKey(column.key)}
                style={widthStyle(column.key)}
                className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
              >
                {column.header}
                <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = String(row.monthKey || row.label || index);
            const selected = selectedRowKey === rowKey;
            return (
              <tr
                key={rowKey}
                onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? "" : rowKey))}
                className={`${styles.tableInteractiveRow} ${selected ? styles.tableSelectedRow : ""}`}
              >
                {columns.map((column) => {
                  const value = row[column.key];
                  const content =
                    column.key === "label"
                      ? value || "-"
                      : column.type === "percent" || column.type === "percentReach"
                        ? formatPercent(value)
                        : formatNumber(value);
                  const reachStyle = column.type === "percentReach" ? reachCellStyle(value) : null;
                  return (
                    <td
                      key={`${rowKey}-${column.key}`}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      className={`${hoveredColumnKey === column.key ? styles.tableColumnGlow : ""} ${
                        column.key === "label" ? styles.tableStrong : ""
                      }`}
                      style={widthStyle(column.key, reachStyle ? { ...reachStyle, fontWeight: 700 } : {})}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
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
  const columns = [
    { key: "desk", header: "Desk" },
    { key: "teamLeader", header: "Team Leader" },
    { key: "agent", header: "Agent" },
    { key: "totalLeads", header: "Leads" },
    { key: "totalFtd", header: "FTD" },
    { key: "selfs", header: "Selfs" },
    { key: "lateFtd", header: "Late FTD +30 Day" },
    { key: "cr", header: "CR", type: "percent" },
    { key: "crTarget", header: "CR Target", type: "percent" },
    { key: "crTargetReach", header: "CR Target Reach", type: "percentReach" },
    { key: "ftdTarget", header: "FTD Target" },
    { key: "ftdTargetReach", header: "FTD Target Reach", type: "percentReach" },
  ];
  const [hoveredColumnKey, setHoveredColumnKey] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const { startResize, widthStyle } = useResizableColumns();
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.tableSticky}`} style={{ minWidth: 1150 }} onMouseLeave={() => setHoveredColumnKey("")}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                onMouseEnter={() => setHoveredColumnKey(column.key)}
                style={widthStyle(column.key)}
                className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
              >
                {column.header}
                <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = `${row.desk}-${row.teamLeader}-${row.agent}-${index}`;
            const selected = selectedRowKey === rowKey;
            return (
              <tr
                key={rowKey}
                onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? "" : rowKey))}
                className={`${styles.tableInteractiveRow} ${selected ? styles.tableSelectedRow : ""}`}
              >
                {columns.map((column) => {
                  const value = row[column.key];
                  const content =
                    column.type === "percent" || column.type === "percentReach"
                      ? formatPercent(value)
                      : ["desk", "teamLeader", "agent"].includes(column.key)
                        ? String(value || "-")
                        : formatNumber(value);
                  const reachStyle = column.type === "percentReach" ? reachCellStyle(value) : null;
                  return (
                    <td
                      key={`${rowKey}-${column.key}`}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      className={`${hoveredColumnKey === column.key ? styles.tableColumnGlow : ""} ${
                        column.key === "agent" ? styles.tableStrong : ""
                      }`}
                      style={widthStyle(column.key, reachStyle ? { ...reachStyle, fontWeight: 700 } : {})}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
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
            <td className={styles.tableStrong} style={{ ...reachCellStyle(summary.crTargetReach), fontWeight: 700 }}>
              {formatPercent(summary.crTargetReach)}
            </td>
            <td className={styles.tableStrong}>{formatNumber(summary.ftdTarget)}</td>
            <td className={styles.tableStrong} style={{ ...reachCellStyle(summary.ftdTargetReach), fontWeight: 700 }}>
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
  const [hoveredColumnKey, setHoveredColumnKey] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const { startResize, widthStyle } = useResizableColumns();
  return (
    <div className={`${styles.panel} ${styles.tableCard}`}>
      <div className={styles.tableScroll}>
      <table
        className={`${styles.table} ${styles.tableSticky}`}
        style={{ minWidth: 1880, "--sticky-second-row-top": "28px" }}
        onMouseLeave={() => setHoveredColumnKey("")}
      >
        <thead>
          <tr>
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("desk")}
              className={hoveredColumnKey === "desk" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("desk"),
              }}
            >
              Desk
              <ColumnResizeHandle columnKey="desk" onResizeStart={startResize} />
            </th>
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("teamLeader")}
              className={hoveredColumnKey === "teamLeader" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("teamLeader"),
              }}
            >
              Team Leader
              <ColumnResizeHandle columnKey="teamLeader" onResizeStart={startResize} />
            </th>
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("agent")}
              className={hoveredColumnKey === "agent" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("agent"),
              }}
            >
              Agent
              <ColumnResizeHandle columnKey="agent" onResizeStart={startResize} />
            </th>
            {monthBlocks.map((month, index) => {
              const theme = last4MonthTheme(index);
              return (
              <th
                key={month.key}
                colSpan={6}
                style={{
                  textAlign: "center",
                  padding: "6px 10px",
                  borderBottom: "1px solid #dbe3ee",
                  fontSize: 12,
                  background: theme.dark,
                  color: "#fff",
                  borderLeft: `1px solid ${theme.line}`,
                  borderRight: `1px solid ${theme.line}`,
                }}
              >
                {month.label}
              </th>
              );
            })}
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("startDate")}
              className={hoveredColumnKey === "startDate" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("startDate"),
              }}
            >
              Starting Date
              <ColumnResizeHandle columnKey="startDate" onResizeStart={startResize} />
            </th>
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("monthsWorked")}
              className={hoveredColumnKey === "monthsWorked" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("monthsWorked"),
              }}
            >
              Months Worked
              <ColumnResizeHandle columnKey="monthsWorked" onResizeStart={startResize} />
            </th>
            <th
              rowSpan={2}
              onMouseEnter={() => setHoveredColumnKey("currentStatus")}
              className={hoveredColumnKey === "currentStatus" ? styles.tableColumnGlow : ""}
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid #dbe3ee",
                fontSize: 12,
                background: "#334155",
                color: "#fff",
                ...widthStyle("currentStatus"),
              }}
            >
              Current Status
              <ColumnResizeHandle columnKey="currentStatus" onResizeStart={startResize} />
            </th>
          </tr>
          <tr>
            {monthBlocks.map((month, index) => (
              <FragmentMetricHeaders
                key={month.key}
                theme={last4MonthTheme(index)}
                monthKey={month.key}
                hoveredColumnKey={hoveredColumnKey}
                onHoverColumn={setHoveredColumnKey}
                onResizeStart={startResize}
                widthStyle={widthStyle}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowKey = String(row.key || row.agent || rowIndex);
            const selected = selectedRowKey === rowKey;
            return (
              <tr
                key={rowKey}
                onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? "" : rowKey))}
                className={`${styles.tableInteractiveRow} ${selected ? styles.tableSelectedRow : ""}`}
              >
                <td
                  onMouseEnter={() => setHoveredColumnKey("desk")}
                  className={hoveredColumnKey === "desk" ? styles.tableColumnGlow : ""}
                  style={widthStyle("desk", { padding: "8px 12px", borderBottom: "1px solid #eef2f7" })}
                >
                  {row.desk}
                </td>
                <td
                  onMouseEnter={() => setHoveredColumnKey("teamLeader")}
                  className={hoveredColumnKey === "teamLeader" ? styles.tableColumnGlow : ""}
                  style={widthStyle("teamLeader", { padding: "8px 12px", borderBottom: "1px solid #eef2f7" })}
                >
                  {row.teamLeader}
                </td>
                <td
                  onMouseEnter={() => setHoveredColumnKey("agent")}
                  className={hoveredColumnKey === "agent" ? styles.tableColumnGlow : ""}
                  style={widthStyle("agent", { padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 })}
                >
                  {row.agent}
                </td>
                {monthBlocks.map((month, index) => {
                  const metric = row.months?.[month.key] || {};
                  const theme = last4MonthTheme(index);
                  return (
                    <FragmentMetricCells
                      key={`${rowKey}-${month.key}`}
                      metric={metric}
                      theme={theme}
                      monthKey={month.key}
                      hoveredColumnKey={hoveredColumnKey}
                      onHoverColumn={setHoveredColumnKey}
                      widthStyle={widthStyle}
                    />
                  );
                })}
                <td
                  onMouseEnter={() => setHoveredColumnKey("startDate")}
                  className={hoveredColumnKey === "startDate" ? styles.tableColumnGlow : ""}
                  style={widthStyle("startDate", {
                    padding: "8px 12px",
                    borderBottom: "1px solid #eef2f7",
                    fontWeight: 600,
                  })}
                >
                  {row.startDate || "-"}
                </td>
                <td
                  onMouseEnter={() => setHoveredColumnKey("monthsWorked")}
                  className={hoveredColumnKey === "monthsWorked" ? styles.tableColumnGlow : ""}
                  style={widthStyle("monthsWorked", {
                    padding: "8px 12px",
                    borderBottom: "1px solid #eef2f7",
                    fontWeight: 600,
                  })}
                >
                  {row.monthsWorked === "-" ? "-" : `${row.monthsWorked} month${Number(row.monthsWorked) === 1 ? "" : "s"}`}
                </td>
                <td
                  onMouseEnter={() => setHoveredColumnKey("currentStatus")}
                  className={hoveredColumnKey === "currentStatus" ? styles.tableColumnGlow : ""}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eef2f7",
                    fontWeight: 700,
                    ...workingStatusStyle(row.currentStatus),
                    ...widthStyle("currentStatus"),
                  }}
                >
                  {row.currentStatus || "Not Working"}
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={6 + monthBlocks.length * 6} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
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

function FragmentMetricHeaders({ theme, monthKey = "", hoveredColumnKey = "", onHoverColumn, onResizeStart, widthStyle }) {
  const metricColumns = [
    { key: "target", label: "Target" },
    { key: "ftd", label: "FTD" },
    { key: "cr", label: "CR" },
    { key: "crTarget", label: "CR Target" },
    { key: "crTargetReach", label: "CR Reach" },
    { key: "ftdTargetReach", label: "FTD Reach" },
  ];
  const baseStyle = {
    textAlign: "left",
    padding: "5px 8px",
    borderBottom: "1px solid #dbe3ee",
    fontSize: 11,
    background: theme?.light || "#f8fafc",
    color: "#0f172a",
  };
  return (
    <>
      {metricColumns.map((column, index) => {
        const columnKey = `${monthKey}__${column.key}`;
        return (
          <th
            key={columnKey}
            onMouseEnter={() => onHoverColumn?.(columnKey)}
            className={hoveredColumnKey === columnKey ? styles.tableColumnGlow : ""}
            style={{
              ...baseStyle,
              ...(index === 0 ? { borderLeft: `1px solid ${theme?.line || "#334155"}` } : {}),
              ...(index === metricColumns.length - 1 ? { borderRight: `1px solid ${theme?.line || "#334155"}` } : {}),
              ...(widthStyle ? widthStyle(columnKey) : {}),
            }}
          >
            {column.label}
            <ColumnResizeHandle columnKey={columnKey} onResizeStart={onResizeStart} />
          </th>
        );
      })}
    </>
  );
}

function FragmentMetricCells({ metric = {}, theme, monthKey = "", hoveredColumnKey = "", onHoverColumn, widthStyle }) {
  const crReach = Number(metric.crTargetReach || 0);
  const ftdReach = Number(metric.ftdTargetReach || 0);
  const baseStyle = {
    padding: "7px 9px",
    borderBottom: "1px solid #eef2f7",
    background: theme?.light || "#fff",
  };
  const metricColumns = [
    { key: "target", render: (value) => formatNumber(value) },
    { key: "ftd", render: (value) => formatNumber(value) },
    { key: "cr", render: (value) => formatPercent(value) },
    { key: "crTarget", render: (value) => formatPercent(value) },
    { key: "crTargetReach", render: (value) => formatPercent(value), reachStyle: reachCellStyle(crReach) },
    { key: "ftdTargetReach", render: (value) => formatPercent(value), reachStyle: reachCellStyle(ftdReach) },
  ];
  return (
    <>
      {metricColumns.map((column, index) => {
        const columnKey = `${monthKey}__${column.key}`;
        const value = metric[column.key];
        return (
          <td
            key={columnKey}
            onMouseEnter={() => onHoverColumn?.(columnKey)}
            className={hoveredColumnKey === columnKey ? styles.tableColumnGlow : ""}
            style={{
              ...baseStyle,
              ...(index === 0 ? { borderLeft: `1px solid ${theme?.line || "#334155"}` } : {}),
              ...(index === metricColumns.length - 1 ? { borderRight: `1px solid ${theme?.line || "#334155"}` } : {}),
              ...(column.reachStyle ? { background: column.reachStyle.background, color: column.reachStyle.color } : {}),
              ...(column.reachStyle ? { fontWeight: 700 } : {}),
              ...(widthStyle ? widthStyle(columnKey) : {}),
            }}
          >
            {column.render(value)}
          </td>
        );
      })}
    </>
  );
}

function LoadingReportIndicator({ monitor = {} }) {
  const progress = Number(monitor.progress || 0);
  const safeProgress = Math.max(0, Math.min(100, progress));
  return (
    <section className={`${styles.panel} ${styles.loadingCard}`}>
      <div className={styles.loadingTitle}>
        <span className={styles.loadingIcon}>🤖</span>
        <span>{monitor.currentStep || "Building your report..."}</span>
      </div>
      <div className={styles.loadingTrack}>
        <div className={styles.loadingBar} style={{ width: `${safeProgress || 35}%`, animation: "none" }} />
      </div>
      <p className={styles.loadingHint}>
        Start: {monitor.startTime ? new Date(monitor.startTime).toLocaleTimeString() : "-"} | Elapsed:{" "}
        {formatElapsedMs(monitor.elapsedMs)} | Progress: {safeProgress.toFixed(0)}%
      </p>
      <p className={styles.loadingHint}>
        Rows loaded: {formatNumber(monitor.totalRowsLoaded || 0)} | After filters: {formatNumber(monitor.rowsAfterFiltering || 0)} |
        Processed: {formatNumber(monitor.rowsProcessed || 0)}
      </p>
      <p className={styles.loadingHint}>
        Sheet: <strong>{monitor.currentSheet || "-"}</strong> | Tab: <strong>{monitor.currentTab || "-"}</strong>
      </p>
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

function monthKeyFromDateValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const isoMonthMatch = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (isoMonthMatch) {
    return `${isoMonthMatch[1]}-${isoMonthMatch[2]}`;
  }
  const dmyMatch = normalized.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmyMatch) {
    const [, , month, year] = dmyMatch;
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromPivotColumnKey(columnKey = "") {
  const matched = String(columnKey || "").match(/^month_(.+?)__/);
  if (!matched) {
    return "";
  }
  const monthKey = String(matched[1] || "").trim();
  if (!monthKey || monthKey === "__grand_total__") {
    return "";
  }
  return monthKey;
}

function compareBuilderValues(left, right, type) {
  if (type === "number" || type === "percent") {
    return Number(left || 0) - Number(right || 0);
  }
  return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true, sensitivity: "base" });
}

function formatColumnGroupLabel(value = "") {
  return String(value || "") === "__grand_total__" ? "Grand Total" : String(value || "");
}

function BuilderTable({ columns = [], rows = [], sortState, onSort, builder = {} }) {
  const [hoveredColumnKey, setHoveredColumnKey] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const { startResize, widthStyle } = useResizableColumns();
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
  const pivotGroupStartKeySet = new Set(
    isColumnPivot && perGroupMetricCount > 0
      ? pivotMetricColumns.filter((_, index) => index % perGroupMetricCount === 0).map((column) => column.key)
      : [],
  );
  return (
    <div className={`${styles.panel} ${styles.tableCard}`} style={{ maxHeight: "70vh" }}>
      <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.tableSticky}`} style={{ minWidth: 900 }} onMouseLeave={() => setHoveredColumnKey("")}>
        <thead>
          {isColumnPivot ? (
            <>
              <tr>
                {dimensionColumns.map((column) => {
                  const active = sortState.key === column.key;
                  const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th
                      key={column.key}
                      rowSpan={2}
                      onClick={() => onSort(column.key)}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      style={widthStyle(column.key, { cursor: "pointer" })}
                      className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
                    >
                      {column.label}
                      {suffix}
                      <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
                    </th>
                  );
                })}
                {builder.columnValues.map((value) => (
                  <th key={`group-${value}`} colSpan={perGroupMetricCount} className={styles.tableGroupHeader}>
                    {formatColumnGroupLabel(value)}
                  </th>
                ))}
                {pivotTailColumns.map((column) => {
                  const active = sortState.key === column.key;
                  const suffix = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th
                      key={column.key}
                      rowSpan={2}
                      onClick={() => onSort(column.key)}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      style={widthStyle(column.key, { cursor: "pointer" })}
                      className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
                    >
                      {column.label}
                      {suffix}
                      <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
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
                    <th
                      key={column.key}
                      onClick={() => onSort(column.key)}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      style={widthStyle(column.key, { cursor: "pointer" })}
                      className={`${styles.tableSubHeader} ${
                        pivotGroupStartKeySet.has(column.key) ? styles.tableSubHeaderGroupStart : ""
                      } ${hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}`}
                    >
                      {metricName}
                      {suffix}
                      <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
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
                    onMouseEnter={() => setHoveredColumnKey(column.key)}
                    style={widthStyle(column.key, { cursor: "pointer" })}
                    className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
                  >
                    {column.label}
                    {suffix}
                    <ColumnResizeHandle columnKey={column.key} onResizeStart={startResize} />
                  </th>
                );
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = String(row.__rowKey || row.key || `${row.__rowKind || "row"}-${index}`);
            const selected = selectedRowKey === rowKey;
            const rowStartMonthKey = monthKeyFromDateValue(row.workStartDate);
            const rowAgentName = String(row.agent || "").trim();
            const canApplyHistoricalBlank =
              builder?.columnDimension === "month" &&
              row.__rowKind !== "total" &&
              rowStartMonthKey &&
              rowAgentName &&
              rowAgentName !== "-";
            return (
              <tr
                key={`builder-${rowKey}`}
                onClick={() => setSelectedRowKey((prev) => (prev === rowKey ? "" : rowKey))}
                className={`${row.__rowKind === "total" ? styles.tableTotalRow : ""} ${styles.tableInteractiveRow} ${
                  selected ? styles.tableSelectedRow : ""
                }`}
              >
                {columns.map((column) => {
                  const isReach = column.type === "percent" && column.key.toLowerCase().includes("reach");
                  const isBenchmarkRate = column.key === "ftdBenchmarkRate" || column.key.endsWith("__ftdBenchmarkRate");
                  const isWorkCurrentStatus = column.key === "workCurrentStatus";
                  const columnMonthKey = monthKeyFromPivotColumnKey(column.key);
                  const isHistoricalBeforeStartMonth =
                    canApplyHistoricalBlank && columnMonthKey && columnMonthKey < rowStartMonthKey;
                  const value = row[column.key];
                  const reachStyle = isReach ? reachCellStyle(value) : null;
                  const displayValue = isHistoricalBeforeStartMonth ? "" : formatBuilderCell(value, column.type);
                  const benchmarkStyle = isBenchmarkRate ? benchmarkRateStyle(value) : null;
                  const statusStyle = isWorkCurrentStatus ? workingStatusStyle(value) : null;
                  return (
                    <td
                      key={`${index}-${column.key}`}
                      onMouseEnter={() => setHoveredColumnKey(column.key)}
                      className={hoveredColumnKey === column.key ? styles.tableColumnGlow : ""}
                      style={widthStyle(column.key, {
                        color: isHistoricalBeforeStartMonth
                          ? "#94a3b8"
                          : isWorkCurrentStatus
                            ? statusStyle.color
                            : isBenchmarkRate
                              ? benchmarkStyle.color
                              : isReach
                                ? reachStyle.color
                                : "#0f172a",
                        background: isHistoricalBeforeStartMonth
                          ? "#f8fafc"
                          : isWorkCurrentStatus
                            ? statusStyle.background
                            : isBenchmarkRate
                              ? benchmarkStyle.background
                              : isReach
                                ? reachStyle.background
                              : undefined,
                        borderLeft: pivotGroupStartKeySet.has(column.key) ? "1px solid #bfdbfe" : undefined,
                        fontWeight: isHistoricalBeforeStartMonth ? 500 : isWorkCurrentStatus || isBenchmarkRate ? 700 : undefined,
                      })}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            );
          })}
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
  { key: "status", label: "Status", type: "text" },
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
  reportMode: "specific",
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
  includeColumnGrandTotal: false,
  agentProductivityPlanMode: false,
  includeWorkTime: false,
  hideNotWorking: false,
  benchmarkMode: false,
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

const QUICK_PRESET_MONTHLY_METRICS = ["leads", "ftd", "ftdTarget", "ftdTargetReach", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_LAST4_METRICS = ["ftd", "ftdTarget", "ftdTargetReach", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_ROW_DIMENSIONS = ["desk", "teamLeader", "agent"];
const QUICK_PRESET_TRAFFIC_ROW_DIMENSIONS = ["desk", "country", "campaign", "subCampaign", "placement"];
const QUICK_PRESET_TRAFFIC_METRICS = [
  "leads",
  "leadShare",
  "agentCount",
  "avgLeadByAgentDaily",
  "avgLeadByAgent",
  "ftd",
  "crTarget",
  "crTargetReach",
  "missingFtd",
];
const QUICK_PRESET_BENCHMARK_METRICS = ["ftd", "agentAvgFtdPerWorkedMonth", "avgFtdByDeskLongTerm", "ftdBenchmarkRate"];
const QUICK_PRESET_COUNTRY_DAILY_ROW_DIMENSIONS = ["country"];
const QUICK_PRESET_COUNTRY_DAILY_METRICS = ["cr", "leads", "ftd", "crTarget", "crTargetReach", "missingFtd"];
const QUICK_PRESET_DESK_COUNTRY_CR_ROW_DIMENSIONS = ["desk", "country"];
const QUICK_PRESET_DESK_COUNTRY_CR_METRICS = ["ftd", "crTargetReach", "cr"];
const QUICK_PRESET_COUNTRY_CAMPAIGN_CR_ROW_DIMENSIONS = ["country", "campaign"];
const QUICK_PRESET_COUNTRY_CAMPAIGN_CR_METRICS = ["ftd", "cr", "leads", "crTargetReach"];
const QUICK_PRESET_STATUS_ROW_DIMENSIONS = ["status"];
const QUICK_PRESET_STATUS_METRICS = ["leadShare", "leads", "ftd", "cr", "crTarget", "crTargetReach"];
const QUICK_PRESET_COMPARISON_ROW_DIMENSIONS = ["country", "campaign", "placement", "subCampaign", "teamLeader", "agent"];
const QUICK_PRESET_COMPARISON_METRICS = ["leads", "ftd", "cr", "crTargetReach"];
const QUICK_PRESET_AGENT_PRODUCTIVITY_ROW_DIMENSIONS = ["country"];
const QUICK_PRESET_AGENT_PRODUCTIVITY_METRICS = ["leads", "ftd", "cr", "crTargetReach", "crTarget", "ftdTarget", "agentCount"];
const COMPARISON_TABLE_DIMENSIONS = [
  { key: "country", label: "Country" },
  { key: "teamLeader", label: "Team Leader" },
  { key: "agent", label: "Agent" },
  { key: "campaign", label: "Campaign" },
  { key: "placement", label: "Placement" },
  { key: "subCampaign", label: "Sub-Campaign" },
];
const COMPARISON_DEFAULT_SORT = { key: "leads", direction: "desc" };
const COMPARISON_COLUMNS = [
  { key: "label", label: "Name", type: "text" },
  { key: "leads", label: "Leads", type: "number" },
  { key: "ftd", label: "FTD", type: "number" },
  { key: "cr", label: "CR", type: "number" },
  { key: "crTargetReach", label: "CR Target Reach", type: "number" },
];

function asOptions(values = []) {
  return values.map((value) => ({ value, label: value }));
}

function toMetricNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function ComparisonTablesPanel({ rows = [], selections = {}, onToggleSelection }) {
  const [sortByTable, setSortByTable] = useState(() =>
    Object.fromEntries(COMPARISON_TABLE_DIMENSIONS.map((dimension) => [dimension.key, COMPARISON_DEFAULT_SORT])),
  );
  const cleanRows = useMemo(
    () => (Array.isArray(rows) ? rows.filter((row) => row && row.__rowKind !== "total") : []),
    [rows],
  );

  const toggleSort = useCallback((tableKey, columnKey) => {
    const safeTableKey = String(tableKey || "").trim();
    const safeColumnKey = String(columnKey || "").trim();
    if (!safeTableKey || !safeColumnKey) {
      return;
    }
    setSortByTable((prev) => {
      const current = prev[safeTableKey] || COMPARISON_DEFAULT_SORT;
      const nextDirection =
        current.key === safeColumnKey ? (current.direction === "asc" ? "desc" : "asc") : safeColumnKey === "label" ? "asc" : "desc";
      return {
        ...prev,
        [safeTableKey]: {
          key: safeColumnKey,
          direction: nextDirection,
        },
      };
    });
  }, []);

  const tables = useMemo(() => {
    return COMPARISON_TABLE_DIMENSIONS.map((dimension) => {
      const filteredRows = cleanRows.filter((row) =>
        COMPARISON_TABLE_DIMENSIONS.every((dimensionItem) => {
          if (dimensionItem.key === dimension.key) {
            return true;
          }
          const selectedValue = String(selections?.[dimensionItem.key] || "").trim();
          if (!selectedValue) {
            return true;
          }
          const rowValue = String(row?.[dimensionItem.key] || "").trim();
          return rowValue === selectedValue;
        }),
      );

      const grouped = new Map();
      for (const row of filteredRows) {
        const label = String(row?.[dimension.key] || "").trim();
        if (!label || label === "-") {
          continue;
        }
        if (!grouped.has(label)) {
          grouped.set(label, { label, leads: 0, ftd: 0, targetBase: 0 });
        }
        const bucket = grouped.get(label);
        const leads = toMetricNumber(row?.leads);
        const ftd = toMetricNumber(row?.ftd);
        const crTarget = toMetricNumber(row?.crTarget);
        const crTargetReach = toMetricNumber(row?.crTargetReach);
        bucket.leads += leads;
        bucket.ftd += ftd;
        if (crTarget > 0) {
          bucket.targetBase += leads * (crTarget / 100);
        } else if (crTargetReach > 0 && ftd > 0) {
          bucket.targetBase += ftd / (crTargetReach / 100);
        }
      }

      const data = [...grouped.values()]
        .map((item) => ({
          ...item,
          cr: item.leads > 0 ? (item.ftd / item.leads) * 100 : 0,
          crTargetReach: item.targetBase > 0 ? (item.ftd / item.targetBase) * 100 : 0,
        }))
        .sort((left, right) => {
          const sortState = sortByTable?.[dimension.key] || COMPARISON_DEFAULT_SORT;
          const sortKey = sortState.key || "leads";
          const sortDirection = sortState.direction === "asc" ? "asc" : "desc";
          let baseCompare = 0;
          if (sortKey === "label") {
            baseCompare = String(left.label || "").localeCompare(String(right.label || ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          } else {
            baseCompare = toMetricNumber(left[sortKey]) - toMetricNumber(right[sortKey]);
          }
          if (baseCompare === 0) {
            baseCompare = String(left.label || "").localeCompare(String(right.label || ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          }
          return sortDirection === "asc" ? baseCompare : -baseCompare;
        });

      return {
        ...dimension,
        rows: data,
        sort: sortByTable?.[dimension.key] || COMPARISON_DEFAULT_SORT,
      };
    });
  }, [cleanRows, selections, sortByTable]);

  return (
    <section className={styles.section} style={{ padding: 0 }}>
      <h3 className={styles.sectionTitle}>Comparison Tables</h3>
      <div className={styles.comparisonGrid}>
        {tables.map((table) => {
          const selectedValue = String(selections?.[table.key] || "").trim();
          return (
            <div key={`comparison-${table.key}`} className={`${styles.panel} ${styles.tableCard}`}>
              <div className={styles.comparisonHeader}>
                <h4 className={styles.comparisonTitle}>{table.label}</h4>
                {selectedValue ? (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => onToggleSelection?.(table.key, selectedValue)}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className={styles.tableScroll}>
                <table className={`${styles.table} ${styles.tableSticky} ${styles.comparisonTable}`}>
                  <thead>
                    <tr>
                      {COMPARISON_COLUMNS.map((column) => {
                        const isActive = table.sort?.key === column.key;
                        const sortSuffix = isActive ? (table.sort?.direction === "asc" ? " ▲" : " ▼") : "";
                        const headerLabel = column.key === "label" ? table.label : column.label;
                        return (
                          <th
                            key={`${table.key}-header-${column.key}`}
                            onClick={() => toggleSort(table.key, column.key)}
                            className={styles.comparisonSortableHeader}
                          >
                            {headerLabel}
                            {sortSuffix}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, index) => {
                      const isSelected = selectedValue && selectedValue === row.label;
                      const reachStyle = reachCellStyle(row.crTargetReach);
                      return (
                        <tr
                          key={`${table.key}-${row.label}-${index}`}
                          className={`${styles.tableInteractiveRow} ${isSelected ? styles.tableSelectedRow : ""}`}
                          onClick={() => onToggleSelection?.(table.key, row.label)}
                        >
                          <td className={`${styles.tableStrong} ${styles.comparisonNameCell}`}>
                            <span className={styles.comparisonNameText}>{row.label}</span>
                          </td>
                          <td>{formatNumber(row.leads)}</td>
                          <td>{formatNumber(row.ftd)}</td>
                          <td>{formatPercent(row.cr)}</td>
                          <td style={{ ...reachStyle, fontWeight: 700 }}>{formatPercent(row.crTargetReach)}</td>
                        </tr>
                      );
                    })}
                    {!table.rows.length ? (
                      <tr>
                        <td colSpan={5} className={styles.tableEmpty}>
                          No rows found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
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
  const [executionMonitor, setExecutionMonitor] = useState({
    active: false,
    startTime: "",
    startedAtMs: 0,
    elapsedMs: 0,
    currentStep: "",
    progress: 0,
    totalRowsLoaded: 0,
    rowsAfterFiltering: 0,
    rowsProcessed: 0,
    currentSheet: "",
    currentTab: "",
    error: "",
    failedStep: "",
  });
  const [builderSort, setBuilderSort] = useState({ key: "", direction: "asc" });
  const [exportState, setExportState] = useState({ loading: false, error: "" });
  const [quickPreset, setQuickPreset] = useState("");
  const [comparisonSelections, setComparisonSelections] = useState({});

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
        officeScope: Array.isArray(prev.officeScope) && prev.officeScope.length ? [prev.officeScope[0]] : officeScopeDefault,
        monthKey: Array.isArray(prev.monthKey) && prev.monthKey.length ? prev.monthKey : monthDefault,
      }));
      setAppliedFilters((prev) => ({
        ...prev,
        officeScope: Array.isArray(prev.officeScope) && prev.officeScope.length ? [prev.officeScope[0]] : officeScopeDefault,
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
    const startedAtMs = Date.now();
    setExecutionMonitor({
      active: true,
      startTime: new Date(startedAtMs).toISOString(),
      startedAtMs,
      elapsedMs: 0,
      currentStep: "Loading Google Sheets",
      progress: 5,
      totalRowsLoaded: 0,
      rowsAfterFiltering: 0,
      rowsProcessed: 0,
      currentSheet: "",
      currentTab: "",
      error: "",
      failedStep: "",
    });
    setExportState((prev) => ({ ...prev, error: "" }));
    try {
      const query = buildReportQuery(appliedFilters);
      query.set("monitor", "1");
      const response = await fetch(`/api/dashboard/report?${query.toString()}`, { cache: "no-store" });
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      let reportPayload = null;
      if (!response.body || !contentType.includes("application/x-ndjson")) {
        const payload = await readApiPayload(response);
        if (!response.ok || !payload.ok) {
          throw new Error(payload?.message || payload?.error || "Could not load report.");
        }
        reportPayload = payload.report;
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = String(line || "").trim();
            if (!trimmed) {
              continue;
            }
            let event = null;
            try {
              event = JSON.parse(trimmed);
            } catch {
              continue;
            }
            if (event?.type === "progress") {
              setExecutionMonitor((prev) => ({
                ...prev,
                active: true,
                startTime: event.startTime || prev.startTime,
                startedAtMs: event.startTime ? Date.parse(event.startTime) || prev.startedAtMs : prev.startedAtMs,
                elapsedMs: Number(event.elapsedMs || prev.elapsedMs || 0),
                currentStep: event.step || prev.currentStep,
                progress: Number(event.progress || prev.progress || 0),
                totalRowsLoaded: Number(event.totalRowsLoaded || prev.totalRowsLoaded || 0),
                rowsAfterFiltering: Number(event.rowsAfterFiltering || prev.rowsAfterFiltering || 0),
                rowsProcessed: Number(event.rowsProcessed || prev.rowsProcessed || 0),
                currentSheet: String(event.currentSheet || prev.currentSheet || ""),
                currentTab: String(event.currentTab || prev.currentTab || ""),
              }));
              continue;
            }
            if (event?.type === "error") {
              streamError = event;
              continue;
            }
            if (event?.type === "result") {
              reportPayload = event.report;
            }
          }
        }
        if (streamError) {
          const errorMessage = streamError?.message || streamError?.error || "Could not load report.";
          const failedStep = streamError?.stage || streamError?.step || "";
          setExecutionMonitor((prev) => ({
            ...prev,
            active: false,
            elapsedMs: Number(streamError?.elapsedMs || Date.now() - startedAtMs),
            error: errorMessage,
            failedStep,
            rowsProcessed: Number(streamError?.rowsProcessed || prev.rowsProcessed || 0),
            currentSheet: String(streamError?.currentSheet || prev.currentSheet || ""),
            currentTab: String(streamError?.currentTab || prev.currentTab || ""),
          }));
          throw new Error(errorMessage);
        }
      }
      if (!reportPayload) {
        const interruptedMessage = "Report stream ended before completion (likely timeout).";
        setExecutionMonitor((prev) => ({
          ...prev,
          active: false,
          elapsedMs: Date.now() - startedAtMs,
          error: interruptedMessage,
          failedStep: prev.failedStep || prev.currentStep || "",
        }));
        throw new Error(interruptedMessage);
      }
      setReportState({
        loading: false,
        report: reportPayload,
        error: "",
      });
      setExecutionMonitor((prev) => ({
        ...prev,
        active: false,
        elapsedMs: Date.now() - startedAtMs,
        currentStep: "Completed",
        progress: 100,
        error: "",
        failedStep: "",
      }));
      const options = reportPayload?.options || {};
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
      setExecutionMonitor((prev) => ({
        ...prev,
        active: false,
        elapsedMs: Date.now() - startedAtMs,
        error: error?.message || "Could not load report.",
        failedStep: prev.failedStep || prev.currentStep || "",
      }));
    }
  }, [appliedFilters, sessionState.authorized]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    requestReport();
  }, [requestReport]);

  useEffect(() => {
    if (!executionMonitor.active || !executionMonitor.startedAtMs) {
      return undefined;
    }
    const intervalId = setInterval(() => {
      setExecutionMonitor((prev) =>
        prev.active
          ? {
              ...prev,
              elapsedMs: Date.now() - Number(prev.startedAtMs || Date.now()),
            }
          : prev,
      );
    }, 200);
    return () => clearInterval(intervalId);
  }, [executionMonitor.active, executionMonitor.startedAtMs]);

  useEffect(() => {
    if (quickPreset !== "comparison-report") {
      setComparisonSelections({});
    }
  }, [quickPreset]);

  useEffect(() => {
    const hasOfficeScope = Array.isArray(filters.officeScope) && filters.officeScope.length > 0;
    if (!hasOfficeScope || filters.reportMode) {
      return;
    }
    setFilters((prev) => ({ ...prev, reportMode: "specific", specificType: "builder" }));
  }, [filters.officeScope, filters.reportMode]);

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

  const handleComparisonSelectionToggle = useCallback((dimensionKey, value) => {
    const normalizedKey = String(dimensionKey || "").trim();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue) {
      return;
    }
    setComparisonSelections((prev) => {
      const next = { ...prev };
      if (String(next[normalizedKey] || "").trim() === normalizedValue) {
        delete next[normalizedKey];
      } else {
        next[normalizedKey] = normalizedValue;
      }
      return next;
    });
  }, []);

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
  const isComparisonPreset = quickPreset === "comparison-report";
  const isComparisonReportView = quickPreset === "comparison-report" && report?.tableType === "builder";
  const officeOptions = options.officeScopes || sessionState.bootstrap.officeScopes || [];
  const monthOptions = useMemo(() => {
    const source = options.months || sessionState.bootstrap.months || [];
    return source.map((item) => ({
      value: item.key,
      label: (() => {
        const officeNames = Array.isArray(item.office_names)
          ? item.office_names.filter(Boolean)
          : item.office_name
            ? [item.office_name]
            : [];
        if (officeNames.length > 1) {
          return `${item.month_label} — ${officeNames.length} Offices`;
        }
        if (officeNames.length === 1) {
          return `${item.month_label} — ${officeNames[0]}`;
        }
        return item.month_label;
      })(),
    }));
  }, [options.months, sessionState.bootstrap.months]);
  const availableMonthKeys = useMemo(() => monthOptions.map((item) => item.value).filter(Boolean), [monthOptions]);
  const applyQuickPreset = useCallback(
    (preset) => {
      setQuickPreset(preset);
      setFilters((prev) => {
        const defaultMonth = availableMonthKeys[0] ? [availableMonthKeys[0]] : prev.monthKey || [];
        const selectedOfficeScope =
          Array.isArray(prev.officeScope) && prev.officeScope.length
            ? [prev.officeScope[0]]
            : officeOptions[0]
              ? [officeOptions[0]]
              : [];
        const clearedTopFilters = {
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
        };
        const basePreset = {
          ...prev,
          officeScope: selectedOfficeScope,
          reportMode: "specific",
          specificType: "builder",
          benchmarkMode: false,
          agentProductivityPlanMode: false,
          columnDimension: "",
          includeColumnGrandTotal: false,
          ...clearedTopFilters,
        };
        if (preset === "monthly") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            includeWorkTime: true,
            hideNotWorking: true,
            rowDimensions: QUICK_PRESET_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_MONTHLY_METRICS,
          };
        }
        if (preset === "last4") {
          return {
            ...basePreset,
            monthKey: availableMonthKeys.slice(0, 4),
            columnDimension: "month",
            includeWorkTime: true,
            hideNotWorking: true,
            rowDimensions: QUICK_PRESET_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_LAST4_METRICS,
          };
        }
        if (preset === "traffic") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            includeWorkTime: true,
            hideNotWorking: true,
            rowDimensions: QUICK_PRESET_TRAFFIC_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_TRAFFIC_METRICS,
          };
        }
        if (preset === "country-daily") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            includeWorkTime: false,
            hideNotWorking: false,
            rowDimensions: QUICK_PRESET_COUNTRY_DAILY_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_COUNTRY_DAILY_METRICS,
          };
        }
        if (preset === "benchmark") {
          return {
            ...basePreset,
            monthKey: availableMonthKeys,
            includeWorkTime: true,
            hideNotWorking: false,
            benchmarkMode: true,
            rowDimensions: QUICK_PRESET_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_BENCHMARK_METRICS,
          };
        }
        if (preset === "desk-country-cr") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            columnDimension: "date",
            includeWorkTime: false,
            hideNotWorking: false,
            rowDimensions: QUICK_PRESET_DESK_COUNTRY_CR_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_DESK_COUNTRY_CR_METRICS,
          };
        }
        if (preset === "country-campaign-hourly-cr") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            columnDimension: "hour",
            includeWorkTime: false,
            hideNotWorking: false,
            rowDimensions: QUICK_PRESET_COUNTRY_CAMPAIGN_CR_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_COUNTRY_CAMPAIGN_CR_METRICS,
          };
        }
        if (preset === "status-watch") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            includeWorkTime: false,
            hideNotWorking: false,
            rowDimensions: QUICK_PRESET_STATUS_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_STATUS_METRICS,
          };
        }
        if (preset === "comparison-report") {
          return {
            ...basePreset,
            monthKey: defaultMonth,
            includeWorkTime: false,
            hideNotWorking: false,
            rowDimensions: QUICK_PRESET_COMPARISON_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_COMPARISON_METRICS,
          };
        }
        if (preset === "agent-productivity-plan") {
          return {
            ...basePreset,
            monthKey: availableMonthKeys,
            columnDimension: "month",
            includeColumnGrandTotal: false,
            includeWorkTime: false,
            hideNotWorking: false,
            agentProductivityPlanMode: true,
            rowDimensions: QUICK_PRESET_AGENT_PRODUCTIVITY_ROW_DIMENSIONS,
            totalDimensions: [],
            metricFields: QUICK_PRESET_AGENT_PRODUCTIVITY_METRICS,
          };
        }
        return prev;
      });
    },
    [availableMonthKeys, officeOptions],
  );
  const draftQueryKey = useMemo(() => buildReportQuery(filters).toString(), [filters]);
  const appliedQueryKey = useMemo(() => buildReportQuery(appliedFilters).toString(), [appliedFilters]);
  const hasPendingChanges = draftQueryKey !== appliedQueryKey;
  useEffect(() => {
    if (quickPreset === "comparison-report") {
      setComparisonSelections({});
    }
  }, [appliedQueryKey, quickPreset]);
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
  const selectedOfficeValue = Array.isArray(filters.officeScope) ? filters.officeScope[0] || "" : String(filters.officeScope || "");
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
          <p className={styles.sectionHint}>Choose your office first, then filters and quick reports will open.</p>
          <div className={styles.officeGrid}>
            {officeOptions.map((office) => {
              const officeTheme = officeThemeForName(office);
              return (
                <button
                  key={office}
                  type="button"
                  onClick={() => {
                    setQuickPreset("");
                    setFilters((prev) => ({
                      ...prev,
                      officeScope: [office],
                      reportMode: "specific",
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
                      includeColumnGrandTotal: false,
                      agentProductivityPlanMode: false,
                      includeWorkTime: false,
                      hideNotWorking: false,
                      benchmarkMode: false,
                    }));
                  }}
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

      {!needOfficeSelection ? (
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
                onClick={() => setQuickPreset("")}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                Reset Quick Reports
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
              <SelectFilter
                label="Office"
                value={selectedOfficeValue}
                options={officeOptions.map((value) => ({ value, label: value }))}
                loading={reportState.loading}
                onChange={(value) => {
                  setQuickPreset("");
                  setFilters((prev) => ({
                    ...prev,
                    officeScope: value ? [value] : [],
                    reportMode: "specific",
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
                    includeColumnGrandTotal: false,
                    agentProductivityPlanMode: false,
                    includeWorkTime: false,
                    hideNotWorking: false,
                    benchmarkMode: false,
                  }));
                }}
                placeholder="Select office"
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
                <DateRangeFilter
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

      {!needOfficeSelection ? (
        <section className={`${styles.panel} ${styles.section} ${styles.stepCenter}`}>
          <h2 className={styles.sectionTitle}>Quick Reports</h2>
          <p className={styles.sectionHint}>Use presets to auto-fill filters and builder selections.</p>
          <div className={styles.reportModeGrid}>
            <button
              type="button"
              onClick={() => applyQuickPreset("monthly")}
              className={styles.reportModeCard}
              style={quickPreset === "monthly" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Monthly Quick</span>
              <span className={styles.reportModeIcon}>{reportModeMeta("monthly").icon}</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("last4")}
              className={styles.reportModeCard}
              style={quickPreset === "last4" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Last 4 Months Quick</span>
              <span className={styles.reportModeIcon}>{reportModeMeta("last4").icon}</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("traffic")}
              className={styles.reportModeCard}
              style={quickPreset === "traffic" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Traffic Reports</span>
              <span className={styles.reportModeIcon}>🚦</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("country-daily")}
              className={styles.reportModeCard}
              style={quickPreset === "country-daily" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Country Daily Watch</span>
              <span className={styles.reportModeIcon}>🌍</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("benchmark")}
              className={styles.reportModeCard}
              style={quickPreset === "benchmark" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Benchmark Report</span>
              <span className={styles.reportModeIcon}>📈</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("desk-country-cr")}
              className={styles.reportModeCard}
              style={quickPreset === "desk-country-cr" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Desk Country Daily CR Watch</span>
              <span className={styles.reportModeIcon}>🧭</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("country-campaign-hourly-cr")}
              className={styles.reportModeCard}
              style={
                quickPreset === "country-campaign-hourly-cr"
                  ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" }
                  : undefined
              }
            >
              <span className={styles.reportModeTitle}>Country Campaign Hourly CR Watch</span>
              <span className={styles.reportModeIcon}>🕒</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("status-watch")}
              className={styles.reportModeCard}
              style={quickPreset === "status-watch" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Status Performance Watch</span>
              <span className={styles.reportModeIcon}>🏷️</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("comparison-report")}
              className={styles.reportModeCard}
              style={quickPreset === "comparison-report" ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" } : undefined}
            >
              <span className={styles.reportModeTitle}>Comparison Report</span>
              <span className={styles.reportModeIcon}>⚖️</span>
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset("agent-productivity-plan")}
              className={styles.reportModeCard}
              style={
                quickPreset === "agent-productivity-plan"
                  ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" }
                  : undefined
              }
            >
              <span className={styles.reportModeTitle}>Agent Productivity vs Plan Report</span>
              <span className={styles.reportModeIcon}>📊</span>
            </button>
          </div>
        </section>
      ) : null}

      {!needOfficeSelection && filters.reportMode === "specific" && filters.specificType === "builder" ? (
        <section className={`${styles.panel} ${styles.section}`}>
          <h2 className={styles.sectionTitle}>Report Builder</h2>
          <SingleChoiceChipGroup
            label="Column"
            items={builderColumnDimensionOptions}
            selectedKey={filters.columnDimension}
            onSelect={(value) =>
              setFilters((prev) => ({
                ...prev,
                columnDimension: value,
                includeColumnGrandTotal: value ? prev.includeColumnGrandTotal : false,
              }))
            }
            noLabel="No"
            grandTotalLabel="Column Grand Total"
            grandTotalEnabled={Boolean(filters.includeColumnGrandTotal)}
            onToggleGrandTotal={(nextEnabled) =>
              setFilters((prev) => ({
                ...prev,
                includeColumnGrandTotal: prev.columnDimension ? Boolean(nextEnabled) : false,
              }))
            }
            locked={isComparisonPreset}
            activeClassName={isComparisonPreset ? styles.chipActiveLocked : ""}
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
            locked={isComparisonPreset}
            activeClassName={isComparisonPreset ? styles.chipActiveLocked : ""}
          />
          <div className={styles.workTimeToggleRow}>
            <span className={styles.workTimeToggleLabel}>Work Time</span>
            <button
              type="button"
              disabled={isComparisonPreset}
              className={`${styles.workTimeToggle} ${filters.includeWorkTime ? styles.workTimeToggleOn : ""}`}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  includeWorkTime: !prev.includeWorkTime,
                  hideNotWorking: prev.includeWorkTime ? false : prev.hideNotWorking,
                }))
              }
            >
              <span className={styles.workTimeToggleThumb} />
              <span>{filters.includeWorkTime ? "ON" : "OFF"}</span>
            </button>
            {filters.includeWorkTime && !isComparisonPreset ? (
              <>
                <span className={styles.workTimeToggleLabel}>Hide Not Working</span>
                <button
                  type="button"
                  className={`${styles.workTimeToggle} ${filters.hideNotWorking ? styles.workTimeToggleOn : ""}`}
                  onClick={() => setFilters((prev) => ({ ...prev, hideNotWorking: !prev.hideNotWorking }))}
                >
                  <span className={styles.workTimeToggleThumb} />
                  <span>{filters.hideNotWorking ? "ON" : "OFF"}</span>
                </button>
              </>
            ) : null}
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
            locked={isComparisonPreset}
            activeClassName={isComparisonPreset ? styles.chipActiveLocked : ""}
          />
        </section>
      ) : null}

      {reportState.loading ? <LoadingReportIndicator monitor={executionMonitor} /> : null}
      {!reportState.loading && executionMonitor.error ? (
        <section className={`${styles.panel} ${styles.loadingCard}`}>
          <div className={styles.loadingTitle}>
            <span>Report Execution Failed</span>
          </div>
          <p className={styles.loadingHint}>
            Failed Step: <strong>{executionMonitor.failedStep || executionMonitor.currentStep || "-"}</strong>
          </p>
          <p className={styles.loadingHint}>
            Error: <strong>{executionMonitor.error}</strong>
          </p>
          <p className={styles.loadingHint}>
            Elapsed: {formatElapsedMs(executionMonitor.elapsedMs)} | Rows loaded: {formatNumber(executionMonitor.totalRowsLoaded || 0)} |
            After filters: {formatNumber(executionMonitor.rowsAfterFiltering || 0)} | Processed: {formatNumber(executionMonitor.rowsProcessed || 0)}
          </p>
          <p className={styles.loadingHint}>
            Sheet: <strong>{executionMonitor.currentSheet || "-"}</strong> | Tab: <strong>{executionMonitor.currentTab || "-"}</strong>
          </p>
        </section>
      ) : null}
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
          {!isComparisonReportView ? <SummaryCards summary={report.summary || {}} /> : null}
          {!isComparisonReportView ? <StatusCards stats={report.stats || {}} /> : null}
          {report.tableType === "pivot" ? <PivotTable rows={report.table || []} summary={report.summary || {}} /> : null}
          {report.tableType === "last4_matrix" ? (
            <Last4MatrixTable rows={report.table || []} monthBlocks={report.monthBlocks || []} />
          ) : null}
          {report.tableType === "builder" ? (
            <section className={styles.section} style={{ padding: 0 }}>
              {isComparisonReportView ? (
                <ComparisonTablesPanel
                  rows={report.table || []}
                  selections={comparisonSelections}
                  onToggleSelection={handleComparisonSelectionToggle}
                />
              ) : (
                <>
                  <h3 className={styles.sectionTitle}>Results Table</h3>
                  <BuilderTable
                    columns={builderColumns}
                    rows={sortedBuilderRows}
                    sortState={builderSort}
                    onSort={handleBuilderSort}
                    builder={report?.builder || {}}
                  />
                </>
              )}
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
