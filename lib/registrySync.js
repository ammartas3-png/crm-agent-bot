import { getAuthorityConfig, getTabConfig } from "../config/sheetsConfig.js";
import { readSheetRows } from "./googleSheets.js";
import { officeSlug } from "./registry.js";
import { saveReport } from "./reportCache.js";
import { saveSource } from "./leadsStore.js";
import { buildDashboard } from "./reports.js";
import { prepareAuxiliaryRowsForStore, prepareRowsForStore } from "./sheetRowMapper.js";
import { resolveDataTabs } from "./tabResolver.js";
import {
  DESK_LANGUAGE_SOURCE_KEY,
  OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
  officeAgentRosterTabConfig,
  officeDeskLanguageTabConfig,
  rosterSourceKey,
  rosterTabNameForOffice,
} from "./rosterConfig.js";

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

  // Also mirror the office's roster tab into Redis so the dashboard does not
  // read the fixed roster spreadsheet live on every request.
  let rosterStored = 0;
  if (!options.skipRosterSync) {
    try {
      rosterStored = await syncRosterTabForOffice(source.office);
    } catch (error) {
      console.error("Roster sync failed", error);
    }
  }

  return {
    sourceKey: source.sourceKey,
    tabs: tabs.map((tab) => tab.title),
    stored: preparedLeads.length,
    ftdStored: preparedFtd.length,
    infoStored: preparedInfo.length,
    rosterStored,
    totalLeads: dashboard.summary.totalLeads,
    totalFtd: dashboard.summary.totalFtd,
    cr: dashboard.summary.cr,
  };
}

// Syncs one country's roster tab from the fixed roster spreadsheet into Redis.
export async function syncRosterTabForOffice(office = "") {
  const tabName = rosterTabNameForOffice(office);
  if (!tabName) {
    return 0;
  }
  const tabConfig = officeAgentRosterTabConfig(tabName);
  const rows = await readSheetRows("officeAgentRoster", {
    tabConfig,
    spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    cache: false,
  });
  const prepared = prepareAuxiliaryRowsForStore(rows, tabConfig, {});
  saveSource(
    rosterSourceKey(tabName),
    {
      category: "roster",
      rosterTab: tabName,
      spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    },
    prepared,
  );
  return prepared.length;
}

// Syncs the desk-language tab from the fixed roster spreadsheet into Redis.
export async function syncDeskLanguageToStore() {
  const tabConfig = officeDeskLanguageTabConfig();
  const rows = await readSheetRows("officeDeskLanguage", {
    tabConfig,
    spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    cache: false,
  });
  const prepared = prepareAuxiliaryRowsForStore(rows, tabConfig, {});
  saveSource(
    DESK_LANGUAGE_SOURCE_KEY,
    {
      category: "deskLanguage",
      spreadsheetId: OFFICE_AGENT_ROSTER_SPREADSHEET_ID,
    },
    prepared,
  );
  return prepared.length;
}

export async function syncRosterTabsForOffices(offices = []) {
  const uniqueOffices = [...new Set(offices.map((office) => String(office || "").trim()).filter(Boolean))];
  const results = [];
  for (const office of uniqueOffices) {
    try {
      results.push({
        office,
        stored: await syncRosterTabForOffice(office),
      });
    } catch (error) {
      results.push({
        office,
        error: String(error?.message || error).slice(0, 200),
      });
    }
  }
  return results;
}

// Desk language + roster tabs mirrored once after the n8n per-source loop.
export async function syncSharedAuxiliaryDataToStore(sources = []) {
  const deskLanguageStored = await syncDeskLanguageToStore();
  const rosterResults = await syncRosterTabsForOffices(sources.map((source) => source.office));
  return {
    deskLanguageStored,
    rosterResults,
    rosterStored: rosterResults.reduce((sum, item) => sum + Number(item.stored || 0), 0),
  };
}
