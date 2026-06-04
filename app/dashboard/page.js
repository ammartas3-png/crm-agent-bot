"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatNumber(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US");
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number.toFixed(2)}%`;
}

function TelegramLoginWidget({ botUsername, onAuth }) {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!botUsername || !containerRef.current) {
      return undefined;
    }
    const container = containerRef.current;
    container.innerHTML = "";
    window.crmDashboardTelegramAuth = async (user) => {
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
      if (window.crmDashboardTelegramAuth) {
        delete window.crmDashboardTelegramAuth;
      }
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [botUsername, onAuth]);
  return <div ref={containerRef} />;
}

function SelectFilter({ label, value, options, onChange, placeholder = "All" }) {
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 150, flex: 1 }}>
      <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          padding: "8px 10px",
          background: "#fff",
          fontSize: 14,
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
    { label: "Leads", value: formatNumber(summary.totalLeads) },
    { label: "FTD", value: formatNumber(summary.totalFtd) },
    { label: "CR", value: formatPercent(summary.cr) },
    { label: "CR Target", value: formatPercent(summary.crTarget) },
    { label: "CR Target Reach", value: formatPercent(summary.crTargetReach) },
    { label: "Selfs", value: formatNumber(summary.selfs) },
    { label: "Late FTD", value: formatNumber(summary.lateFtd) },
  ];
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{item.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function TableView({ rows }) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
        <thead>
          <tr style={{ background: "#f8fafc", textAlign: "left" }}>
            {["Group", "Leads", "FTD", "CR", "CR Target", "CR Target Reach", "Selfs", "Late FTD"].map((header) => (
              <th key={header} style={{ padding: 12, borderBottom: "1px solid #e2e8f0", fontSize: 13 }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>{row.label}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatNumber(row.totalLeads)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatNumber(row.totalFtd)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatPercent(row.cr)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatPercent(row.crTarget)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatPercent(row.crTargetReach)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatNumber(row.selfs)}</td>
              <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatNumber(row.lateFtd)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: 16, textAlign: "center", color: "#64748b" }}>
                No rows found for selected filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_FILTERS = {
  monthKey: "",
  officeScope: "",
  desk: "",
  country: "",
  brand: "",
  teamLeader: "",
  agent: "",
  groupBy: "agent",
};

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

  const fetchSession = useCallback(async () => {
    setSessionState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const response = await fetch("/api/dashboard/session", { cache: "no-store" });
      const payload = await response.json();
      setSessionState({
        loading: false,
        authenticated: Boolean(payload.authenticated),
        authorized: Boolean(payload.authorized),
        auth: payload.auth || { enabled: false, botUsername: "" },
        user: payload.user || null,
        bootstrap: payload.bootstrap || { defaultMonthKey: "", months: [], officeScopes: [] },
        error: "",
      });
      if (payload.bootstrap?.defaultMonthKey) {
        setFilters((prev) => ({
          ...prev,
          monthKey: prev.monthKey || payload.bootstrap.defaultMonthKey,
        }));
      }
    } catch {
      setSessionState((prev) => ({
        ...prev,
        loading: false,
        error: "Could not load dashboard session.",
      }));
    }
  }, []);

  const requestReport = useCallback(async () => {
    if (!sessionState.authorized || !filters.monthKey) {
      return;
    }
    setReportState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const query = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        const normalizedValue = String(value || "").trim();
        if (normalizedValue) {
          query.set(key, normalizedValue);
        }
      });
      const response = await fetch(`/api/dashboard/report?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.message || payload?.error || "Could not load report.");
      }
      setReportState({
        loading: false,
        report: payload.report,
        error: "",
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
    setFilters(EMPTY_FILTERS);
    await fetchSession();
  }, [fetchSession]);

  const monthOptions = useMemo(() => {
    const reportMonths = reportState.report?.options?.months || [];
    const fallbackMonths = sessionState.bootstrap?.months || [];
    const source = reportMonths.length ? reportMonths : fallbackMonths;
    return source.map((item) => ({
      value: item.key,
      label: item.office_name ? `${item.month_label} — ${item.office_name}` : item.month_label,
    }));
  }, [reportState.report?.options?.months, sessionState.bootstrap?.months]);

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
          background: "#f8fafc",
          display: "grid",
          placeItems: "center",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: 480,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 20,
            display: "grid",
            gap: 14,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24 }}>CRM Dashboard Login</h1>
          <p style={{ margin: 0, color: "#475569" }}>
            Log in with your Telegram account. Access permissions are the same as the Telegram bot.
          </p>
          {sessionState.auth.enabled ? (
            <TelegramLoginWidget botUsername={sessionState.auth.botUsername} onAuth={handleTelegramAuth} />
          ) : (
            <p style={{ margin: 0, color: "#b91c1c" }}>
              Telegram login widget is unavailable. Make sure TELEGRAM_BOT_TOKEN is configured and the bot is reachable.
            </p>
          )}
          {sessionState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{sessionState.error}</p> : null}
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            You can continue using the Telegram bot anytime. This dashboard is an additional interface.
          </p>
        </section>
      </main>
    );
  }

  if (!sessionState.authorized) {
    return (
      <main style={{ fontFamily: "Arial, sans-serif", padding: 24, display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0 }}>CRM Dashboard</h1>
        <p style={{ margin: 0, color: "#b91c1c" }}>
          Your Telegram account is authenticated but not authorized for CRM reports.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          style={{ width: 120, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
        >
          Log out
        </button>
      </main>
    );
  }

  const report = reportState.report;
  const options = report?.options || {};

  return (
    <main
      style={{
        minHeight: "100vh",
        fontFamily: "Arial, sans-serif",
        padding: 18,
        background: "#f8fafc",
        color: "#0f172a",
        display: "grid",
        gap: 16,
      }}
    >
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>CRM Dashboard</h1>
          <p style={{ margin: "6px 0 0", color: "#475569" }}>
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

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "#fff",
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Filters</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <SelectFilter
            label="Month"
            value={filters.monthKey}
            options={monthOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, monthKey: value }))}
            placeholder="Select month"
          />
          <SelectFilter
            label="Office"
            value={filters.officeScope}
            options={(options.officeScopes || sessionState.bootstrap.officeScopes || []).map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                officeScope: value,
                desk: "",
                country: "",
                brand: "",
                teamLeader: "",
                agent: "",
              }))
            }
          />
          <SelectFilter
            label="Desk"
            value={filters.desk}
            options={(options.desks || []).map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, desk: value }))}
          />
          <SelectFilter
            label="Country"
            value={filters.country}
            options={(options.countries || []).map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, country: value }))}
          />
          <SelectFilter
            label="Brand"
            value={filters.brand}
            options={(options.brands || []).map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, brand: value }))}
          />
          <SelectFilter
            label="Team Leader"
            value={filters.teamLeader}
            options={(options.teamLeaders || []).map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, teamLeader: value }))}
          />
          <SelectFilter
            label="Agent"
            value={filters.agent}
            options={(options.agents || []).map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, agent: value }))}
          />
          <SelectFilter
            label="Table Group"
            value={filters.groupBy}
            options={[
              { value: "agent", label: "Agent" },
              { value: "teamLeader", label: "Team Leader" },
              { value: "office", label: "Desk" },
              { value: "country", label: "Country" },
              { value: "brand", label: "Brand / Campaign" },
            ]}
            onChange={(value) => setFilters((prev) => ({ ...prev, groupBy: value }))}
            placeholder="Group by"
          />
        </div>
      </section>

      {reportState.loading ? <p style={{ margin: 0 }}>Loading report...</p> : null}
      {reportState.error ? <p style={{ margin: 0, color: "#b91c1c" }}>{reportState.error}</p> : null}
      {report ? (
        <section style={{ display: "grid", gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {report.month?.label || "Selected month"}
              {report.month?.office_name ? ` — ${report.month.office_name}` : ""}
            </h2>
          </div>
          <SummaryCards summary={report.summary || {}} />
          <TableView rows={report.table || []} />
        </section>
      ) : null}
    </main>
  );
}
