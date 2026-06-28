import { getTabConfig } from "../../config/sheetsConfig.js";
import { createDateRangeFilter } from "../../lib/calculations.js";
import { loadLeadRows } from "../../lib/dataProvider.js";
import { buildDashboard } from "../../lib/reports.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLORS = {
  bg: "#0b0e14",
  card: "#151a23",
  cardAlt: "#1b212c",
  border: "#232b38",
  text: "#e6e9ef",
  muted: "#8b94a7",
  accent: "#3b82f6",
  good: "#34d399",
  warn: "#fbbf24",
};

const DATE_OPTIONS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["thisMonth", "This Month"],
  ["lastMonth", "Last Month"],
  ["all", "All Data"],
];

function buildFilters(searchParams, now) {
  const filters = {};
  for (const key of ["office", "country", "campaign", "teamLeader", "status"]) {
    if (searchParams[key]) {
      filters[key] = searchParams[key];
    }
  }
  const dateKey = searchParams.date || "thisMonth";
  if (dateKey && dateKey !== "all") {
    if (dateKey === "today") {
      filters.date = { type: "today" };
    } else {
      const range = createDateRangeFilter(dateKey, now);
      if (range?.filter) {
        filters.date = range.filter;
      }
    }
  }
  return { filters, dateKey };
}

function dateLabel(dateKey) {
  return DATE_OPTIONS.find(([key]) => key === dateKey)?.[1] || "This Month";
}

function num(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function pct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function LockScreen() {
  return (
    <main style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <form method="get" style={{ background: COLORS.card, padding: 32, borderRadius: 12, border: `1px solid ${COLORS.border}`, width: 320 }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>CRM Dashboard</h1>
        <p style={{ color: COLORS.muted, margin: "0 0 16px", fontSize: 14 }}>Enter the access key to continue.</p>
        <input
          type="password"
          name="key"
          placeholder="Access key"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text, marginBottom: 12 }}
        />
        <button type="submit" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", background: COLORS.accent, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
          Open dashboard
        </button>
      </form>
    </main>
  );
}

function Kpi({ label, value, accent }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "16px 18px", flex: "1 1 160px", minWidth: 160 }}>
      <div style={{ color: COLORS.muted, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent || COLORS.text }}>{value}</div>
    </div>
  );
}

function Table({ title, headers, rows }) {
  return (
    <section style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18, flex: "1 1 360px", minWidth: 320 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{title}</h2>
      {rows.length === 0 ? (
        <div style={{ color: COLORS.muted, fontSize: 14 }}>No data.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} style={{ textAlign: "left", color: COLORS.muted, fontWeight: 500, padding: "6px 8px", borderBottom: `1px solid ${COLORS.border}` }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, index) => (
              <tr key={index} style={{ background: index % 2 ? COLORS.cardAlt : "transparent" }}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} style={{ padding: "6px 8px", color: cellIndex === 0 ? COLORS.text : COLORS.muted }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function Dashboard({ searchParams }) {
  const params = (await searchParams) || {};
  const expectedKey = process.env.INGEST_SECRET || process.env.DASHBOARD_SECRET || "";
  if (expectedKey && params.key !== expectedKey) {
    return <LockScreen />;
  }

  const now = new Date();
  const tabConfig = getTabConfig("leads");
  const { filters, dateKey } = buildFilters(params, now);

  let dashboard = null;
  let error = null;
  try {
    const rows = await loadLeadRows("leads", { tabConfig });
    dashboard = buildDashboard(rows, tabConfig, filters, now, { limit: 10 });
  } catch (caught) {
    error = String(caught?.message || caught);
  }

  const key = params.key || "";
  const link = (date) => `/dashboard?key=${encodeURIComponent(key)}&date=${date}`;

  return (
    <main style={{ background: COLORS.bg, color: COLORS.text, minHeight: "100vh", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>CRM Dashboard</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DATE_OPTIONS.map(([value, label]) => (
              <a
                key={value}
                href={link(value)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  textDecoration: "none",
                  border: `1px solid ${COLORS.border}`,
                  background: value === dateKey ? COLORS.accent : COLORS.card,
                  color: value === dateKey ? "#fff" : COLORS.muted,
                }}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        {error ? (
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.warn}`, borderRadius: 12, padding: 18, color: COLORS.warn }}>
            Could not load data: {error}
            <div style={{ color: COLORS.muted, fontSize: 13, marginTop: 8 }}>
              Run a sync (POST /api/sources) or check Google Sheets credentials.
            </div>
          </div>
        ) : (
          <>
            <div style={{ color: COLORS.muted, marginBottom: 16 }}>
              {dateLabel(dateKey)} · {num(dashboard.rowCount)} rows loaded
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
              <Kpi label="Total Leads" value={num(dashboard.summary.totalLeads)} />
              <Kpi label="Valid Leads" value={num(dashboard.summary.validLeads)} />
              <Kpi label="Total FTD" value={num(dashboard.summary.totalFtd)} accent={COLORS.good} />
              <Kpi label="CR" value={pct(dashboard.summary.cr)} accent={COLORS.accent} />
              <Kpi label="CR Target" value={pct(dashboard.summary.crTarget)} />
              <Kpi label="CR Target Reach" value={pct(dashboard.summary.crTargetReach)} />
              <Kpi label="Late FTD" value={num(dashboard.summary.lateFtd)} accent={COLORS.warn} />
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Table
                title="Top Agents by FTD"
                headers={["Agent", "FTD", "CR"]}
                rows={dashboard.quick.topAgentsByFtd.map((item) => [item.label, num(item.totalFtd), pct(item.cr)])}
              />
              <Table
                title="Top Countries by CR"
                headers={["Country", "FTD", "CR"]}
                rows={dashboard.quick.topCountries.map((item) => [item.label, num(item.totalFtd), pct(item.cr)])}
              />
              <Table
                title="Top Campaigns by FTD"
                headers={["Campaign", "FTD", "CR"]}
                rows={dashboard.quick.topCampaigns.map((item) => [item.label, num(item.totalFtd), pct(item.cr)])}
              />
              <Table
                title="Top Team Leaders by FTD"
                headers={["Team Leader", "FTD", "CR"]}
                rows={dashboard.quick.topTeamLeaders.map((item) => [item.label, num(item.totalFtd), pct(item.cr)])}
              />
              <Table
                title="Status Distribution"
                headers={["Status", "Count", "%"]}
                rows={dashboard.quick.statusDistribution.map((item) => [item.label, num(item.value), pct(item.percentage)])}
              />
              <Table
                title="Hourly (FTD)"
                headers={["Hour", "Leads", "FTD", "CR"]}
                rows={dashboard.quick.hourly.map((item) => [item.hour, num(item.leads), num(item.ftd), pct(item.cr)])}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
