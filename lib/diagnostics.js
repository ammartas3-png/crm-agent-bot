import { getTabConfig, sheetsConfig } from "../config/sheetsConfig.js";
import { getGoogleCredentialConfig, readSheetRows } from "./googleSheets.js";

function maskValue(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= 8) {
    return "***";
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function safeError(error) {
  return {
    name: error?.name || "Error",
    message: String(error?.message || error || "Unknown error").slice(0, 500),
    code: error?.code || error?.response?.status || null,
  };
}

export function sheetsDiagnosticConfig() {
  const tabConfig = getTabConfig("leads");
  const credentialConfig = getGoogleCredentialConfig();
  return {
    serviceAccountEmail: credentialConfig.email,
    spreadsheetId: maskValue(process.env.GOOGLE_SPREADSHEET_ID || sheetsConfig.spreadsheetId),
    leadsRange: tabConfig.range,
    env: {
      googleServiceAccountEmailConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      googlePrivateKeyConfigured: Boolean(credentialConfig.privateKey),
      googlePrivateKeySource: credentialConfig.privateKeySource || "",
      googleSpreadsheetIdConfigured: Boolean(process.env.GOOGLE_SPREADSHEET_ID),
    },
  };
}

export async function checkSheetsConnection(options = {}) {
  const tabConfig = options.tabConfig || getTabConfig("leads");
  try {
    const rows = await readSheetRows("leads", { tabConfig });
    const firstRow = rows[0] || {};
    return {
      ok: true,
      rowCount: rows.length,
      firstRowColumns: Object.keys(firstRow).slice(0, 12),
      config: sheetsDiagnosticConfig(),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeError(error),
      config: sheetsDiagnosticConfig(),
    };
  }
}

export function formatSheetsDiagnostic(result) {
  if (result.ok) {
    return [
      "Sheets diagnostic: OK",
      `Rows read: ${result.rowCount}`,
      `Range: ${result.config.leadsRange}`,
      `Service account: ${result.config.serviceAccountEmail}`,
      result.firstRowColumns.length
        ? `Columns: ${result.firstRowColumns.join(", ")}`
        : "Columns: no rows found",
    ].join("\n");
  }

  return [
    "Sheets diagnostic: FAILED",
    `Error: ${result.error.message}`,
    result.error.code ? `Code: ${result.error.code}` : "",
    `Range: ${result.config.leadsRange}`,
    `Service account: ${result.config.serviceAccountEmail}`,
    result.config.env?.googlePrivateKeySource
      ? `Private key source: ${result.config.env.googlePrivateKeySource}`
      : "Private key source: not detected",
    "",
    "Most likely causes:",
    "- service account is not shared on the Sheet",
    "- GOOGLE_PRIVATE_KEY does not match the service account",
    "- Google Sheets API is not enabled",
    "- tab name/range is wrong",
  ]
    .filter(Boolean)
    .join("\n");
}
