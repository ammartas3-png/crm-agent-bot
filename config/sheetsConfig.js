const DEFAULT_LEADS_COLUMNS = [
  "Brand",
  "ID",
  "Created",
  "Department",
  "Status",
  "Country",
  "Campaign",
  "Sub-Campaign",
  "Placement",
  "First Call Agent",
  "Team Leader",
  "FTD",
  null,
  "FTD MAKER",
  "Desk",
  "CR TARGET",
  "FTD DATE",
  "Selfs",
  "LATE FTD Difrrence",
  "LATE FTD +30 Day",
  "Diffrent Month",
  "AGENT NAMES",
  "Agent ID",
  null,
  "Lead Date",
];

const DEFAULT_FTD_COLUMNS = ["Date", "Customer ID", "Agent", "Country", "Amount"];

const DEFAULT_TRANSACTION_COLUMNS = [
  "Date",
  "Customer ID",
  "Amount",
  "Type",
  "Country",
];
const DEFAULT_INFO_AGENTS_COLUMNS = (() => {
  const columns = new Array(42).fill(null);
  columns[0] = "Working Status";
  columns[2] = "Agent Name";
  columns[3] = "Agent Target";
  columns[5] = "Office";
  columns[6] = "Team Leader";
  columns[11] = "Starting Date";
  columns[41] = "Job Entry";
  return columns;
})();
const DEFAULT_AGENT_DIRECTORY_COLUMNS = ["Agent Name", "Agent ID"];

export const DEFAULT_GOOGLE_SPREADSHEET_ID = "1cXyL60QniZevYOb06adN5FPHWN5tbYhiHX12yIa6kG4";
export const DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL =
  "matservice@mitservice.iam.gserviceaccount.com";
export const DEFAULT_LEADS_TAB = "Leads";

// "Bot Authority" registry spreadsheet: an Offices tab mapping office x month to
// the data spreadsheet ID, and a users tab. Lets the bot discover which Google
// Sheets to read instead of hardcoding them.
export const DEFAULT_AUTHORITY_SPREADSHEET_ID =
  "1mwnrhktfXR_E7R15-4uDDk4FG9euG27U5XhrbztsLBc";

export function quoteSheetName(sheetName) {
  const trimmedName = String(sheetName || "").trim();
  return `'${trimmedName.replace(/'/g, "''")}'`;
}

export function sheetRange(sheetName, columns = "A:Z") {
  return `${quoteSheetName(sheetName)}!${String(columns || "A:Z").trim()}`;
}

function columnLabelToIndex(label = "") {
  return String(label || "")
    .trim()
    .toUpperCase()
    .split("")
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
}

function ensureMinEndColumnRange(range, sheetName, minimumEndColumn = "AP") {
  const normalizedRange = String(range || "").trim();
  const match = normalizedRange.match(/!([A-Z]+)\d*:([A-Z]+)\d*$/i);
  if (!match) {
    return normalizedRange || sheetRange(sheetName, `A:${minimumEndColumn}`);
  }
  const startColumn = String(match[1] || "A").toUpperCase();
  const currentEndColumn = String(match[2] || minimumEndColumn).toUpperCase();
  const minEnd = String(minimumEndColumn || "AP").toUpperCase();
  const finalEndColumn =
    columnLabelToIndex(currentEndColumn) >= columnLabelToIndex(minEnd) ? currentEndColumn : minEnd;
  return sheetRange(sheetName, `${startColumn}:${finalEndColumn}`);
}

const leadsTabName = (process.env.GOOGLE_LEADS_TAB || DEFAULT_LEADS_TAB).trim();
const ftdTabName = (process.env.GOOGLE_FTD_TAB || "FTD").trim();
const transactionTabName = (process.env.GOOGLE_TRANSACTION_TAB || "TRANSACTION").trim();
const infoAgentsTabName = (process.env.GOOGLE_INFO_AGENTS_TAB || "Info Agents").trim();
const agentDirectoryTabName = (process.env.GOOGLE_AGENT_DIRECTORY_TAB || "Agent ID").trim();

export const sheetsConfig = {
  spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_GOOGLE_SPREADSHEET_ID,
  serviceAccountEmail:
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL,
  tabs: {
    leads: {
      key: "leads",
      name: leadsTabName,
      range: process.env.GOOGLE_LEADS_RANGE || sheetRange(leadsTabName, "A:Y"),
      columns: DEFAULT_LEADS_COLUMNS,
      fields: {
        brand: "Brand",
        id: "ID",
        created: "Created",
        department: "Department",
        status: "Status",
        country: "Country",
        campaign: "Campaign",
        subCampaign: "Sub-Campaign",
        placement: "Placement",
        firstCallAgent: "First Call Agent",
        teamLeader: "Team Leader",
        ftd: "FTD",
        ftdMaker: "FTD MAKER",
        office: "Desk",
        desk: "Desk",
        crTarget: "CR TARGET",
        ftdDate: "FTD DATE",
        selfsIndicator: "Selfs",
        lateFtdDifference: "LATE FTD Difrrence",
        lateFtdPlus30Day: "LATE FTD +30 Day",
        differentMonth: "Diffrent Month",
        agentNames: "AGENT NAMES",
        agentId: "Agent ID",
        leadDate: "Lead Date",
      },
    },
    ftd: {
      key: "ftd",
      name: ftdTabName,
      range: process.env.GOOGLE_FTD_RANGE || sheetRange(ftdTabName),
      dateColumn: "Date",
      countryColumn: "Country",
      agentColumn: "AGENTS",
      statusColumn: null,
      amountColumn: "Amount",
      columns: DEFAULT_FTD_COLUMNS,
      fields: {
        agent: "AGENTS",
        customerId: "CID",
        country: "LIST OF COUNTRYS",
      },
    },
    transactions: {
      key: "transactions",
      name: transactionTabName,
      range: process.env.GOOGLE_TRANSACTION_RANGE || sheetRange(transactionTabName),
      dateColumn: "Date",
      countryColumn: "Country",
      agentColumn: null,
      statusColumn: "Type",
      amountColumn: "Amount",
      columns: DEFAULT_TRANSACTION_COLUMNS,
    },
    infoAgents: {
      key: "infoAgents",
      name: infoAgentsTabName,
      range: ensureMinEndColumnRange(
        process.env.GOOGLE_INFO_AGENTS_RANGE || sheetRange(infoAgentsTabName, "A:AP"),
        infoAgentsTabName,
        "AP",
      ),
      columns: DEFAULT_INFO_AGENTS_COLUMNS,
      fields: {
        workingStatus: "Working Status",
        agentName: "Agent Name",
        agentTarget: "Agent Target",
        office: "Office",
        teamLeader: "Team Leader",
      },
    },
    agentDirectory: {
      key: "agentDirectory",
      name: agentDirectoryTabName,
      range: process.env.GOOGLE_AGENT_DIRECTORY_RANGE || sheetRange(agentDirectoryTabName, "A:B"),
      columns: DEFAULT_AGENT_DIRECTORY_COLUMNS,
      fields: {
        agentName: "Agent Name",
        agentId: "Agent ID",
      },
    },
  },
};

export function getTabConfig(tabKey) {
  const tab = sheetsConfig.tabs[tabKey];
  if (!tab) {
    throw new Error(`Unknown sheet tab config: ${tabKey}`);
  }
  return tab;
}

export function getAuthorityConfig(env = process.env) {
  const officesTab = (env.GOOGLE_AUTHORITY_OFFICES_TAB || "Offices").trim();
  const usersTab = (env.GOOGLE_AUTHORITY_USERS_TAB || "users").trim();
  const dataTab = (env.GOOGLE_AUTHORITY_DATA_TAB || leadsTabName).trim();
  return {
    spreadsheetId: env.GOOGLE_AUTHORITY_SPREADSHEET_ID || DEFAULT_AUTHORITY_SPREADSHEET_ID,
    officesTab,
    usersTab,
    officesRange: sheetRange(officesTab, "A:Z"),
    usersRange: sheetRange(usersTab, "A:Z"),
    // Tab/range to read inside each office's monthly spreadsheet.
    dataTab,
    dataRange: env.GOOGLE_AUTHORITY_DATA_RANGE || sheetRange(dataTab, "A:Y"),
  };
}
