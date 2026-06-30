import { getAuthorityConfig, getTabConfig } from "../config/sheetsConfig.js";
import { readSheetRows } from "./googleSheets.js";
import { officeSlug } from "./registry.js";
import { saveReport } from "./reportCache.js";
import { saveSource } from "./leadsStore.js";
import { buildDashboard } from "./reports.js";
import { prepareAuxiliaryRowsForStore, prepareRowsForStore } from "./sheetRowMapper.js";
import { resolveDataTabs } from "./tabResolver.js";

function sourceKeyFor(office, period, category) {
  return `${officeSlug(office)}:${period}:${category}`;
}

async function readOptionalTabRows(tabKey, tabConfig, spreadsheetId) {
  try {
    return await readSheetRows(tabKey, {
      tabConfig,
      spreadsheetId,
      cache: false,
    });
  } catch {
    return [];
  }
}

// Reads one office/month spreadsheet from Google Sheets and mirrors leads, FTD
// and Info Agents rows into Redis via leadsStore (plus the compact report cache).
export async function syncOfficeSourceToStore(source, options = {}) {
  const leadsConfig = options.leadsConfig || getTabConfig("leads");
  const ftdConfig = options.ftdConfig || getTabConfig("ftd");
  const infoAgentsConfig = options.infoAgentsConfig || getTabConfig("infoAgents");
  const authorityCfg = options.authorityConfig || getAuthorityConfig();

  const tabs = await resolveDataTabs(source.spreadsheetId, leadsConfig, {
    fallbackTab: authorityCfg.dataTab,
  });
  const combinedRows = [];
  for (const tab of tabs) {
    const rows = await readSheetRows("leads", {
      tabConfig: { ...leadsConfig, range: tab.range },
      spreadsheetId: source.spreadsheetId,
      cache: false,
    });
    for (const row of rows) {
      combinedRows.push(row);
    }
  }

  const baseMeta = {
    office: source.office,
    period: source.period,
    spreadsheetId: source.spreadsheetId,
  };

  const preparedLeads = prepareRowsForStore(combinedRows, leadsConfig, baseMeta);
  saveSource(source.sourceKey, { ...baseMeta, category: "leads" }, preparedLeads);

  const ftdRows = await readOptionalTabRows("ftd", ftdConfig, source.spreadsheetId);
  const preparedFtd = prepareAuxiliaryRowsForStore(ftdRows, ftdConfig, baseMeta);
  const ftdSourceKey = sourceKeyFor(source.office, source.period, "ftd");
  if (preparedFtd.length > 0) {
    saveSource(ftdSourceKey, { ...baseMeta, category: "ftd" }, preparedFtd);
  }

  const infoRows = await readOptionalTabRows("infoAgents", infoAgentsConfig, source.spreadsheetId);
  const preparedInfo = prepareAuxiliaryRowsForStore(infoRows, infoAgentsConfig, baseMeta);
  const infoSourceKey = sourceKeyFor(source.office, source.period, "infoAgents");
  if (preparedInfo.length > 0) {
    saveSource(infoSourceKey, { ...baseMeta, category: "infoAgents" }, preparedInfo);
  }

  const dashboard = buildDashboard(preparedLeads, leadsConfig, {}, options.now || new Date(), {
    limit: 10,
  });
  saveReport(source.sourceKey, { office: source.office, period: source.period }, dashboard);

  return {
    sourceKey: source.sourceKey,
    tabs: tabs.map((tab) => tab.title),
    stored: preparedLeads.length,
    ftdStored: preparedFtd.length,
    infoStored: preparedInfo.length,
    totalLeads: dashboard.summary.totalLeads,
    totalFtd: dashboard.summary.totalFtd,
    cr: dashboard.summary.cr,
  };
}
