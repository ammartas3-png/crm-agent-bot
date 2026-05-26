import { sheetsConfig } from "../../config/sheetsConfig.js";
import { listMonthFiles } from "../../lib/monthlyReports.js";

const pageStyle = {
  fontFamily: "Arial, sans-serif",
  lineHeight: 1.5,
  padding: 32,
  maxWidth: 1200,
  margin: "0 auto",
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #d1d5db",
  background: "#f9fafb",
};

const tdStyle = {
  padding: "8px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

const codeStyle = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  background: "#f8fafc",
  padding: "2px 6px",
  borderRadius: 6,
};

function fieldRows(fields = {}) {
  return Object.entries(fields).map(([logicKey, sheetColumn]) => ({
    logicKey,
    sheetColumn,
  }));
}

function statusBadge(active) {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    color: active ? "#166534" : "#991b1b",
    background: active ? "#dcfce7" : "#fee2e2",
    border: `1px solid ${active ? "#86efac" : "#fecaca"}`,
  };
}

export const dynamic = "force-dynamic";

export default function ReportMapPage() {
  const monthFiles = listMonthFiles({ includeInactive: true });
  const leadsTab = sheetsConfig.tabs.leads;
  const infoAgentsTab = sheetsConfig.tabs.infoAgents;

  const flowLines = [
    "/start",
    "-> Section: Results from Months Table",
    "-> Month Select (or Last 4 Months)",
    "-> Date Filter (except Last 4 mode)",
    "-> Report Filter (Office / Team Leader / Agent / Country / Campaign)",
    "-> Drilldown",
    "-> Export Excel / All (Excel)",
  ];

  return (
    <main style={pageStyle}>
      <h1 style={{ marginBottom: 8 }}>Raporlama Haritasi</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>
        Bu ekran sadece goruntuleme amaclidir. Buradan botun akisini ve veri eslestirmelerini takip edebilirsin.
      </p>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>1) Akis Haritasi</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {flowLines.map((line) => (
            <li key={line} style={{ marginBottom: 4 }}>
              {line}
            </li>
          ))}
        </ol>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>2) Leads Sheet Mapping</h2>
        <p>
          Tab: <span style={codeStyle}>{leadsTab.name}</span> | Range:{" "}
          <span style={codeStyle}>{leadsTab.range}</span>
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Logic Key</th>
              <th style={thStyle}>Sheet Column Name</th>
            </tr>
          </thead>
          <tbody>
            {fieldRows(leadsTab.fields).map((row) => (
              <tr key={row.logicKey}>
                <td style={tdStyle}>
                  <span style={codeStyle}>{row.logicKey}</span>
                </td>
                <td style={tdStyle}>{row.sheetColumn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>3) Info Agents Mapping</h2>
        <p>
          Tab: <span style={codeStyle}>{infoAgentsTab.name}</span> | Range:{" "}
          <span style={codeStyle}>{infoAgentsTab.range}</span>
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Logic Key</th>
              <th style={thStyle}>Sheet Column Name</th>
            </tr>
          </thead>
          <tbody>
            {fieldRows(infoAgentsTab.fields).map((row) => (
              <tr key={row.logicKey}>
                <td style={tdStyle}>
                  <span style={codeStyle}>{row.logicKey}</span>
                </td>
                <td style={tdStyle}>{row.sheetColumn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>4) Month File Mapping</h2>
        <p style={{ color: "#475569" }}>
          Last 4 Months modu bu listedeki aktif aylardan son 4 tanesini kullanir.
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Month Key</th>
              <th style={thStyle}>Month Label</th>
              <th style={thStyle}>Sheet ID</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {monthFiles.map((item) => (
              <tr key={item.key}>
                <td style={tdStyle}>
                  <span style={codeStyle}>{item.key}</span>
                </td>
                <td style={tdStyle}>{item.month_label}</td>
                <td style={tdStyle}>
                  <span style={codeStyle}>{item.sheet_id}</span>
                </td>
                <td style={tdStyle}>
                  <span style={statusBadge(item.active !== false)}>
                    {item.active === false ? "Inactive" : "Active"}
                  </span>
                </td>
                <td style={tdStyle}>{item.updated_at || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
