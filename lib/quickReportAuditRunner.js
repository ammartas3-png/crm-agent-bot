import { loadDashboardReport } from "./dashboardService.js";
import { getOfficeMonthMap } from "./officeMappings.js";
import { auditReportResult, summarizeAuditResults } from "./quickReportAudit.js";
import {
  QUICK_REPORT_PRESET_KEYS,
  QUICK_REPORT_PRESET_LABELS,
  buildQuickReportQuery,
} from "./quickReportPresets.js";

const ADMIN_ACCESS = {
  authorized: true,
  authorityScope: { unrestricted: true, role: "admin" },
  permissionFilters: {},
  telegramUser: { id: 0, username: "audit" },
};

function monthKeysForOffice(officeMap, officeName = "") {
  const records = officeMap?.byOffice?.[officeName] || [];
  return records
    .filter((record) => record?.active !== false && String(record?.key || "").trim())
    .map((record) => String(record.key).trim())
    .sort((left, right) => right.localeCompare(left));
}

export async function runQuickReportAudit({
  offices = [],
  presets = QUICK_REPORT_PRESET_KEYS,
  monthKey = "",
  maxRuns = 40,
  startedAt = Date.now(),
  timeBudgetMs = 7 * 60 * 1000,
} = {}) {
  const officeMap = await getOfficeMonthMap().catch(() => ({ offices: [], byOffice: {} }));
  const officeList =
    offices.length > 0
      ? offices
      : (officeMap.offices || []).map((item) => String(item?.name || item || "").trim()).filter(Boolean);

  const runs = [];
  let truncated = false;

  for (const office of officeList) {
    const monthKeys = monthKeysForOffice(officeMap, office);
    const selectedMonthKeys = monthKey ? [monthKey] : monthKeys;
    if (!selectedMonthKeys.length) {
      runs.push({
        office,
        preset: "*",
        monthKey: monthKey || "-",
        issues: [
          {
            code: "no_month_mapping",
            severity: "warn",
            message: `No active month mapping for office ${office}`,
            office,
          },
        ],
        elapsedMs: 0,
      });
      continue;
    }

    for (const preset of presets) {
      if (runs.length >= maxRuns || Date.now() - startedAt > timeBudgetMs) {
        truncated = true;
        break;
      }
      const queryMonthKeys = preset === "last4" ? selectedMonthKeys.slice(0, 4) : selectedMonthKeys;
      const query = buildQuickReportQuery({
        office,
        monthKeys: queryMonthKeys,
        preset,
      });
      const runStartedAt = Date.now();
      try {
        const report = await loadDashboardReport(ADMIN_ACCESS, query);
        const issues = auditReportResult(report, {
          office,
          preset,
          presetLabel: QUICK_REPORT_PRESET_LABELS[preset] || preset,
          monthKey: String(query.monthKey || ""),
        });
        runs.push({
          office,
          preset,
          presetLabel: QUICK_REPORT_PRESET_LABELS[preset] || preset,
          monthKey: String(query.monthKey || ""),
          tableType: report?.tableType || "",
          summary: report?.summary || {},
          issues,
          elapsedMs: Date.now() - runStartedAt,
        });
      } catch (error) {
        runs.push({
          office,
          preset,
          presetLabel: QUICK_REPORT_PRESET_LABELS[preset] || preset,
          monthKey: String(query.monthKey || ""),
          issues: [
            {
              code: "report_load_failed",
              severity: "error",
              message: error?.message || "Could not load report.",
              office,
              preset,
            },
          ],
          error: error?.message || "Could not load report.",
          elapsedMs: Date.now() - runStartedAt,
        });
      }
    }
    if (truncated) {
      break;
    }
  }

  return {
    ...summarizeAuditResults(runs),
    truncated,
    auditedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}
