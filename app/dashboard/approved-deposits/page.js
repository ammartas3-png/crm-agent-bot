"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

const CATEGORIES = ["Native", "English", "Other"];
const CATEGORY_COLORS = {
  Native: "#2563eb",
  English: "#10b981",
  Other: "#f59e0b",
};
const EMPTY_FILTERS = {
  language: [],
  country: [],
  month: [],
  status: [],
  brand: [],
  campaign: [],
  method: [],
  cashier: [],
  department: [],
  ftd: [],
};

function formatUsd(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function categoryStats(bucket = {}, category = "") {
  return bucket?.[category] || { amount: 0, count: 0, share: 0 };
}

function bucketTotalAmount(bucket = {}) {
  return CATEGORIES.reduce((sum, category) => sum + Number(categoryStats(bucket, category).amount || 0), 0);
}

function BucketCell({ bucket, category }) {
  const stats = categoryStats(bucket, category);
  const amount = Number(stats.amount || 0);
  if (!amount && !Number(stats.count || 0)) {
    return <span style={{ color: "#f59e0b" }}>-</span>;
  }
  return (
    <span>
      <strong style={{ color: CATEGORY_COLORS[category] }}>{formatPercent(stats.share)}</strong>
      <span style={{ color: "#64748b" }}> ({formatUsd(amount)})</span>
    </span>
  );
}

function KpiCard({ title, stats, totalAmount }) {
  const amount = Number(stats?.amount || 0);
  const share = Number(totalAmount || 0) > 0 ? (amount / Number(totalAmount || 0)) * 100 : 0;
  return (
    <div className={styles.panel} style={{ padding: 16, minWidth: 180 }}>
      <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <strong style={{ fontSize: 22 }}>{formatUsd(amount)}</strong>
        <span style={{ color: "#64748b", fontSize: 12 }}>{Number(stats?.count || 0).toLocaleString("en-US")} rows</span>
      </div>
      {title !== "Total Deposits" ? <div style={{ color: "#64748b", fontSize: 12 }}>{formatPercent(share)}</div> : null}
    </div>
  );
}

function StackedBar({ bucket }) {
  const total = bucketTotalAmount(bucket);
  if (!total) {
    return <div style={{ height: 22, borderRadius: 4, background: "#f1f5f9" }} />;
  }
  return (
    <div style={{ display: "flex", height: 22, overflow: "hidden", borderRadius: 4, background: "#f1f5f9" }}>
      {CATEGORIES.map((category) => {
        const stats = categoryStats(bucket, category);
        const width = Math.max(0, (Number(stats.amount || 0) / total) * 100);
        if (width <= 0) {
          return null;
        }
        return (
          <div
            key={category}
            title={`${category}: ${formatPercent(width)} (${formatUsd(stats.amount)})`}
            style={{
              width: `${width}%`,
              background: CATEGORY_COLORS[category],
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {width >= 12 ? formatPercent(width) : ""}
          </div>
        );
      })}
    </div>
  );
}

function CountryBars({ title, countries = [], monthKey = "" }) {
  const rows = countries
    .map((country) => ({
      country: country.country,
      bucket: monthKey ? country.months?.[monthKey] : country.total,
    }))
    .filter((row) => bucketTotalAmount(row.bucket) > 0)
    .slice(0, 10);

  return (
    <div className={styles.panel} style={{ padding: 14 }}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {rows.map((row) => (
          <div key={`${title}-${row.country}`} style={{ display: "grid", gridTemplateColumns: "120px 1fr 110px", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right", fontSize: 12, color: "#334155" }}>{row.country}</div>
            <StackedBar bucket={row.bucket} />
            <div style={{ fontSize: 12, color: "#64748b" }}>{formatUsd(bucketTotalAmount(row.bucket))}</div>
          </div>
        ))}
        {!rows.length ? <p className={styles.sectionHint}>No deposit rows for this selection.</p> : null}
      </div>
    </div>
  );
}

function asFilterOptions(values = []) {
  return (Array.isArray(values) ? values : [])
    .filter((item) => item && item !== "All")
    .map((item) => {
      if (typeof item === "string") {
        return { value: item, label: item };
      }
      const value = String(item.key || item.value || "").trim();
      const label = String(item.label || item.key || item.value || "").trim();
      return value ? { value, label: label || value } : null;
    })
    .filter(Boolean);
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

export default function ApprovedDepositsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [reportState, setReportState] = useState({ loading: true, report: null, error: "" });

  const loadReport = useCallback(async () => {
    setReportState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value || "")]),
    );
    const response = await fetch(`/api/dashboard/approved-deposits?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      if (response.status === 401 || payload.error === "unauthenticated") {
        router.push("/dashboard");
        return;
      }
      throw new Error(payload.message || payload.error || "Could not load approved deposits report.");
    }
    setReportState({ loading: false, report: payload.report, error: "" });
  }, [filters, router]);

  useEffect(() => {
    loadReport().catch((error) => {
      setReportState((previous) => ({
        ...previous,
        loading: false,
        error: error?.message || "Could not load approved deposits report.",
      }));
    });
  }, [loadReport]);

  const report = reportState.report;
  const latestMonth = useMemo(() => report?.months?.[0] || null, [report]);
  const totalStats = useMemo(
    () => ({
      amount: Number(report?.totalAmount || 0),
      count: Number(report?.totalCount || 0),
    }),
    [report],
  );

  return (
    <main className={styles.page}>
      <section className={`${styles.panel} ${styles.topBar}`}>
        <div>
          <h1 className={`${styles.title} ${styles.topBarTitle}`}>Approved Deposits - Native / English / Other</h1>
          <p className={`${styles.subtitle} ${styles.topBarSubtitle}`}>
            USD amounts come from the FTD-AMOUNT sheet. KYC sheet is used only to match ACC ID language.
          </p>
        </div>
        <div className={styles.pillRow}>
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => router.push("/dashboard")}>
            Back to Dashboard
          </button>
          <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={loadReport} disabled={reportState.loading}>
            {reportState.loading ? "Loading..." : "Reload"}
          </button>
        </div>
      </section>

      {reportState.error ? (
        <section className={`${styles.panel} ${styles.section}`}>
          <p className={styles.errorText}>{reportState.error}</p>
        </section>
      ) : null}

      <section className={styles.pillRow} style={{ gap: 12 }}>
        <KpiCard title="Total Deposits" stats={totalStats} totalAmount={totalStats.amount} />
        {CATEGORIES.map((category) => (
          <KpiCard key={category} title={category} stats={categoryStats(report?.totals, category)} totalAmount={totalStats.amount} />
        ))}
      </section>

      <section className={`${styles.panel} ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Filters</h2>
        <div className={styles.filterRows}>
          <MultiSelectFilter
            label="Language"
            values={filters.language}
            options={asFilterOptions(report?.options?.languages || CATEGORIES)}
            onChange={(language) => setFilters((previous) => ({ ...previous, language }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Country"
            values={filters.country}
            options={asFilterOptions(report?.options?.countries || [])}
            onChange={(country) => setFilters((previous) => ({ ...previous, country }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Approved Month"
            values={filters.month}
            options={asFilterOptions(report?.options?.months || [])}
            onChange={(month) => setFilters((previous) => ({ ...previous, month }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Status"
            values={filters.status}
            options={asFilterOptions(report?.options?.statuses || [])}
            onChange={(status) => setFilters((previous) => ({ ...previous, status }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Brand"
            values={filters.brand}
            options={asFilterOptions(report?.options?.brands || [])}
            onChange={(brand) => setFilters((previous) => ({ ...previous, brand }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Campaign"
            values={filters.campaign}
            options={asFilterOptions(report?.options?.campaigns || [])}
            onChange={(campaign) => setFilters((previous) => ({ ...previous, campaign }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Method"
            values={filters.method}
            options={asFilterOptions(report?.options?.methods || [])}
            onChange={(method) => setFilters((previous) => ({ ...previous, method }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Cashier"
            values={filters.cashier}
            options={asFilterOptions(report?.options?.cashiers || [])}
            onChange={(cashier) => setFilters((previous) => ({ ...previous, cashier }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="Original Department"
            values={filters.department}
            options={asFilterOptions(report?.options?.departments || [])}
            onChange={(department) => setFilters((previous) => ({ ...previous, department }))}
            loading={reportState.loading}
          />
          <MultiSelectFilter
            label="FTD"
            values={filters.ftd}
            options={asFilterOptions(report?.options?.ftdValues || [])}
            onChange={(ftd) => setFilters((previous) => ({ ...previous, ftd }))}
            loading={reportState.loading}
          />
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Reset filters
          </button>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Deposits (USD) - Country x Category x Month</h2>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableSticky}`}>
            <thead>
              <tr>
                <th rowSpan={2}>Country</th>
                <th colSpan={CATEGORIES.length}>Total</th>
                {(report?.months || []).map((month) => (
                  <th key={month.key} colSpan={CATEGORIES.length}>{month.label}</th>
                ))}
              </tr>
              <tr>
                {[{ key: "total" }, ...(report?.months || [])].flatMap((group) =>
                  CATEGORIES.map((category) => <th key={`${group.key}-${category}`}>{category}</th>),
                )}
              </tr>
            </thead>
            <tbody>
              {(report?.countries || []).map((country) => (
                <tr key={country.country}>
                  <td className={styles.tableStrong}>{country.country}</td>
                  {CATEGORIES.map((category) => (
                    <td key={`${country.country}-total-${category}`}>
                      <BucketCell bucket={country.total} category={category} />
                    </td>
                  ))}
                  {(report?.months || []).map((month) =>
                    CATEGORIES.map((category) => (
                      <td key={`${country.country}-${month.key}-${category}`}>
                        <BucketCell bucket={country.months?.[month.key]} category={category} />
                      </td>
                    )),
                  )}
                </tr>
              ))}
              {report ? (
                <tr className={styles.totalRow}>
                  <td className={styles.tableStrong}>TOTAL</td>
                  {CATEGORIES.map((category) => (
                    <td key={`grand-total-${category}`}>
                      <BucketCell bucket={report.totals} category={category} />
                    </td>
                  ))}
                  {report.months.map((month) =>
                    CATEGORIES.map((category) => (
                      <td key={`grand-${month.key}-${category}`}>
                        <BucketCell bucket={month.total} category={category} />
                      </td>
                    )),
                  )}
                </tr>
              ) : null}
              {!reportState.loading && !report?.countries?.length ? (
                <tr>
                  <td colSpan={4 + (report?.months?.length || 0) * CATEGORIES.length} className={styles.tableEmpty}>
                    No approved deposit rows found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className={styles.sectionHint}>
          Total amounts are calculated from USD Amount in the FTD-AMOUNT sheet. Language category is joined from KYC by ACC ID.
        </p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <CountryBars title="Selected Period" countries={report?.countries || []} />
        <CountryBars title={latestMonth ? `${latestMonth.label} MTY` : "Latest Month"} countries={report?.countries || []} monthKey={latestMonth?.key || ""} />
      </section>
    </main>
  );
}

