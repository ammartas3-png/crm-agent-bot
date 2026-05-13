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
  "Office",
  "CR TARGET",
  "FTD DATE",
  null,
  "LATE FTD Difrrence",
  null,
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

export const DEFAULT_GOOGLE_SPREADSHEET_ID = "1cXyL60QniZevYOb06adN5FPHWN5tbYhiHX12yIa6kG4";
export const DEFAULT_GOOGLE_SERVICE_ACCOUNT_EMAIL =
  "matservice@mitservice.iam.gserviceaccount.com";
export const DEFAULT_LEADS_TAB = "Leads";

export function quoteSheetName(sheetName) {
  const trimmedName = String(sheetName || "").trim();
  return `'${trimmedName.replace(/'/g, "''")}'`;
}

export function sheetRange(sheetName, columns = "A:Z") {
  return `${quoteSheetName(sheetName)}!${String(columns || "A:Z").trim()}`;
}

const leadsTabName = (process.env.GOOGLE_LEADS_TAB || DEFAULT_LEADS_TAB).trim();
const ftdTabName = (process.env.GOOGLE_FTD_TAB || "FTD").trim();
const transactionTabName = (process.env.GOOGLE_TRANSACTION_TAB || "TRANSACTION").trim();

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
        office: "Office",
        crTarget: "CR TARGET",
        ftdDate: "FTD DATE",
        lateFtdDifference: "LATE FTD Difrrence",
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
      agentColumn: "Agent",
      statusColumn: null,
      amountColumn: "Amount",
      columns: DEFAULT_FTD_COLUMNS,
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
  },
};

export function getTabConfig(tabKey) {
  const tab = sheetsConfig.tabs[tabKey];
  if (!tab) {
    throw new Error(`Unknown sheet tab config: ${tabKey}`);
  }
  return tab;
}
