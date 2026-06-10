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

function Last4MatrixTable({ rows = [], monthBlocks = [] }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1700 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th rowSpan={2} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
              Desk
            </th>
            <th rowSpan={2} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
              Team Leader
            </th>
            <th rowSpan={2} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
              Agent
            </th>
            {monthBlocks.map((month) => (
              <th
                key={month.key}
                colSpan={6}
                style={{ textAlign: "center", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}
              >
                {month.label}
              </th>
            ))}
          </tr>
          <tr style={{ background: "#f8fafc" }}>
            {monthBlocks.map((month) => (
              <FragmentMetricHeaders key={month.key} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key || row.agent}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.desk}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.teamLeader}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.agent}</td>
              {monthBlocks.map((month) => {
                const metric = row.months?.[month.key] || {};
                return (
                  <FragmentMetricCells key={`${row.key || row.agent}-${month.key}`} metric={metric} />
                );
              })}
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={3 + monthBlocks.length * 6} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FragmentMetricHeaders() {
  return (
    <>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>Target</th>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>FTD</th>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>CR</th>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>CR Target</th>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>CR Reach</th>
      <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid #dbe3ee", fontSize: 11 }}>FTD Reach</th>
    </>
  );
}

function FragmentMetricCells({ metric = {} }) {
  return (
    <>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(metric.target)}</td>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(metric.ftd)}</td>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(metric.cr)}</td>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7" }}>{formatPercent(metric.crTarget)}</td>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7", color: reachColor(metric.crTargetReach) }}>
        {formatPercent(metric.crTargetReach)}
      </td>
      <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef2f7", color: reachColor(metric.ftdTargetReach) }}>
        {formatPercent(metric.ftdTargetReach)}
      </td>
    </>
  );
}

function PermissionsTable({ rows = [], autoAllowedFields = [] }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {["User", "Telegram ID", "Authority", "Office", "Desk", "Team", "Auto Allowed"].map((header) => (
              <th key={header} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid #dbe3ee", fontSize: 12 }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.rowNumber}-${row.telegramId}-${row.user}`}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", fontWeight: 600 }}>{row.user}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.telegramId || "-"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.authority || "-"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.office || "all"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.desk || "all"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7" }}>{row.team || "all"}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #eef2f7", color: "#0f766e" }}>
                {(row.autoAllowed || autoAllowedFields || []).join(", ")}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No permission rows found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_FILTERS = {
  officeScope: "",
  reportMode: "",
  specificType: "hourly",
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
};

const EMPTY_PERMISSION_FILTERS = {
  office: "",
  desk: "",
  team: "",
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
  const [permissionFilters, setPermissionFilters] = useState(EMPTY_PERMISSION_FILTERS);
  const [permissionState, setPermissionState] = useState({
    loading: false,
    rows: [],
    options: { offices: [], desks: [], teams: [] },
    autoAllowedFields: [],
    viewerCanSeeAllUsers: false,
    error: "",
  });

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
    setReportState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        const normalized = String(value || "").trim();
        if (normalized) {
          query.set(key, normalized);
        }
      }
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
        const next = { ...prev };
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
      });
    } catch (error) {
      setReportState({
        loading: false,
        report: null,
        error: error?.message || "Could not load report.",
      });
    }
  }, [filters, sessionState.authorized]);

  const requestPermissions = useCallback(async () => {
    const shouldShowPermissionsPreDashboard = !filters.officeScope || !filters.reportMode;
    if (!shouldShowPermissionsPreDashboard) {
      return;
    }
    if (!sessionState.authorized) {
      setPermissionState((prev) => ({
        ...prev,
        loading: false,
        rows: [],
        error: "",
      }));
      return;
    }
    setPermissionState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(permissionFilters)) {
        const normalized = String(value || "").trim();
        if (normalized) {
          query.set(key, normalized);
        }
      }
      const response = await fetch(`/api/dashboard/permissions?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.message || payload?.error || "Could not load permissions.");
      }
      setPermissionState({
        loading: false,
        rows: payload.rows || [],
        options: payload.options || { offices: [], desks: [], teams: [] },
        autoAllowedFields: payload.autoAllowedFields || [],
        viewerCanSeeAllUsers: Boolean(payload.viewerCanSeeAllUsers),
        error: "",
      });
      setPermissionFilters((prev) => {
        const next = { ...prev };
        const options = payload.options || {};
        const checks = [
          ["office", options.offices || []],
          ["desk", options.desks || []],
          ["team", options.teams || []],
        ];
        for (const [key, values] of checks) {
          if (next[key] && !values.includes(next[key])) {
            next[key] = "";
          }
        }
        return next;
      });
    } catch (error) {
      setPermissionState((prev) => ({
        ...prev,
        loading: false,
        rows: [],
        error: error?.message || "Could not load permissions.",
      }));
    }
  }, [filters.officeScope, filters.reportMode, permissionFilters, sessionState.authorized]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    requestReport();
  }, [requestReport]);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

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
    setFilters(EMPTY_FILTERS);
    setPermissionFilters(EMPTY_PERMISSION_FILTERS);
    setPermissionState({
      loading: false,
      rows: [],
      options: { offices: [], desks: [], teams: [] },
      autoAllowedFields: [],
      viewerCanSeeAllUsers: false,
      error: "",
    });
    await fetchSession();
  }, [fetchSession]);

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

      {needOfficeSelection || needReportSelection ? (
        <section style={{ border: "1px solid #dbe3ee", borderRadius: 10, background: "#fff", padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Permissions</h2>
            <p style={{ margin: 0, color: "#64748b" }}>
              Main access filters are Office, Desk, Team. Agent, Country, Campaign, Sub Campaign, Placement and Metrics are auto-allowed
              under those scopes.
            </p>
            {!permissionState.viewerCanSeeAllUsers ? (
              <p style={{ margin: 0, color: "#92400e" }}>You are seeing your own permission rows.</p>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <SelectFilter
              label="Office Scope"
              value={permissionFilters.office}
              options={asOptions(permissionState.options.offices || [])}
              onChange={(value) => setPermissionFilters((prev) => ({ ...prev, office: value, desk: "", team: "" }))}
            />
            <SelectFilter
              label="Desk Scope"
              value={permissionFilters.desk}
              options={asOptions(permissionState.options.desks || [])}
              onChange={(value) => setPermissionFilters((prev) => ({ ...prev, desk: value, team: "" }))}
            />
            <SelectFilter
              label="Team Scope"
              value={permissionFilters.team}
              options={asOptions(permissionState.options.teams || [])}
              onChange={(value) => setPermissionFilters((prev) => ({ ...prev, team: value }))}
            />
          </div>
          {permissionState.loading ? <p style={{ margin: 0 }}>Loading permissions...</p> : null}
          {permissionState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{permissionState.error}</p> : null}
          {!permissionState.loading && !permissionState.error ? (
            <PermissionsTable rows={permissionState.rows || []} autoAllowedFields={permissionState.autoAllowedFields || []} />
          ) : null}
        </section>
      ) : null}

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
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "monthly", specificType: "hourly" }))}
              style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
            >
              Monthly Report
            </button>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "last4", specificType: "hourly" }))}
              style={{ border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", background: "#fff", cursor: "pointer" }}
            >
              Last 4 Months Report
            </button>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "specific", specificType: "hourly" }))}
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
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, reportMode: "" }))}
              style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", background: "#fff", cursor: "pointer" }}
            >
              Change Report Type
            </button>
          </div>
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

      {reportState.loading ? <p style={{ margin: 0 }}>Loading report...</p> : null}
      {reportState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{reportState.error}</p> : null}

      {report ? (
        <section style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {report.month?.label || "Selected month"} — {report.month?.office_name || filters.officeScope}
            </h2>
            <p style={{ margin: 0, color: "#64748b" }}>{report.tableTitle || "Report table"}</p>
          </div>
          <SummaryCards summary={report.summary || {}} />
          <StatusCards stats={report.stats || {}} />
          {report.tableType === "pivot" ? <PivotTable rows={report.table || []} summary={report.summary || {}} /> : null}
          {report.tableType === "last4_matrix" ? (
            <Last4MatrixTable rows={report.table || []} monthBlocks={report.monthBlocks || []} />
          ) : null}
          {report.tableType && report.tableType !== "pivot" && report.tableType !== "last4_matrix" ? (
            <SimpleTable rows={report.table || []} />
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
