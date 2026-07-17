"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function MultiSelectField({ label, value = [], options = [], onChange }) {
  const selectedValues = Array.isArray(value) ? value : [];
  const normalizedOptions = options.map((option) => (typeof option === "string" ? { key: option, label: option } : option));
  const visibleOptions = normalizedOptions.filter((option) => (option.key || option.value) !== "All");
  const displayLabel = selectedValues.length ? `${selectedValues.length} selected` : "All";
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
        {label} <span style={{ fontWeight: 500, textTransform: "none" }}>({displayLabel})</span>
      </span>
      <select
        className={styles.input}
        multiple
        size={Math.min(6, Math.max(3, visibleOptions.length || 3))}
        value={selectedValues}
        onChange={(event) => {
          const nextValues = Array.from(event.target.selectedOptions).map((option) => option.value);
          onChange(nextValues);
        }}
        style={{ minHeight: 86 }}
      >
        {visibleOptions.map((option) => {
          const normalized = option;
          return (
            <option key={normalized.key || normalized.value} value={normalized.key || normalized.value}>
              {normalized.label || normalized.key || normalized.value}
            </option>
          );
        })}
      </select>
    </label>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 12, alignItems: "end" }}>
          <MultiSelectField
            label="Language"
            value={filters.language}
            options={report?.options?.languages || ["All", ...CATEGORIES]}
            onChange={(language) => setFilters((previous) => ({ ...previous, language }))}
          />
          <MultiSelectField
            label="Country"
            value={filters.country}
            options={report?.options?.countries || ["All"]}
            onChange={(country) => setFilters((previous) => ({ ...previous, country }))}
          />
          <MultiSelectField
            label="Approved Month"
            value={filters.month}
            options={report?.options?.months || [{ key: "All", label: "All" }]}
            onChange={(month) => setFilters((previous) => ({ ...previous, month }))}
          />
          <MultiSelectField
            label="Status"
            value={filters.status}
            options={report?.options?.statuses || ["All"]}
            onChange={(status) => setFilters((previous) => ({ ...previous, status }))}
          />
          <MultiSelectField
            label="Brand"
            value={filters.brand}
            options={report?.options?.brands || ["All"]}
            onChange={(brand) => setFilters((previous) => ({ ...previous, brand }))}
          />
          <MultiSelectField
            label="Campaign"
            value={filters.campaign}
            options={report?.options?.campaigns || ["All"]}
            onChange={(campaign) => setFilters((previous) => ({ ...previous, campaign }))}
          />
          <MultiSelectField
            label="Method"
            value={filters.method}
            options={report?.options?.methods || ["All"]}
            onChange={(method) => setFilters((previous) => ({ ...previous, method }))}
          />
          <MultiSelectField
            label="Cashier"
            value={filters.cashier}
            options={report?.options?.cashiers || ["All"]}
            onChange={(cashier) => setFilters((previous) => ({ ...previous, cashier }))}
          />
          <MultiSelectField
            label="Original Department"
            value={filters.department}
            options={report?.options?.departments || ["All"]}
            onChange={(department) => setFilters((previous) => ({ ...previous, department }))}
          />
          <MultiSelectField
            label="FTD"
            value={filters.ftd}
            options={report?.options?.ftdValues || ["All"]}
            onChange={(ftd) => setFilters((previous) => ({ ...previous, ftd }))}
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

