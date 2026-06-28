import { ACTIONS, canAccessAction } from "./actionPermissions.js";
import { isAdminTelegramUser, isSettingsAdminTelegramUser } from "./permissions.js";

export function isHelpCommand(text) {
  return /^\/?help(?:@\w+)?(?:\s+.*)?$/i.test(String(text || "").trim());
}

export function buildHelpText(telegramUser) {
  const isAdmin = isAdminTelegramUser(telegramUser) || isSettingsAdminTelegramUser(telegramUser);
  const canUseDatabaseCheck = canAccessAction(telegramUser, ACTIONS.DATABASE_CHECK);
  const canUseMonthSettings = isSettingsAdminTelegramUser(telegramUser);

  const lines = [
    "CRM Bot Help",
    "",
    "Quick commands:",
    "- /start (or start): open section selector.",
    "- /help: show this guide.",
    "",
    "Main navigation:",
    "1) /start -> Select section",
    "   - Results from Months Table",
  ];

  if (canUseDatabaseCheck) {
    lines.push("   - Database Check");
  } else {
    lines.push("   - Database Check (admin-only)");
  }

  lines.push(
    "",
    "Results from Months Table flow:",
    "1) Select report month.",
    "2) Select filter: Office, Team Leader, Agent, Country, Campaign.",
    "3) Drill down with inline buttons.",
    "4) Use navigation buttons:",
    "   - Back to previous level",
    "   - Back to Report Filters",
    "   - Change Month",
    "5) Use Next Page / Previous Page when list is long.",
    "",
    "Report metrics shown in report outputs:",
    "- Lead, FTD, CR, Selfs, Late FTD",
    "- CR Target, CR Target Reach",
    "- FTD Target, FTD Target Reach",
  );

  if (canUseMonthSettings) {
    lines.push(
      "",
      "Settings (only @antoniotsd):",
      "- Open Settings from month menu.",
      "- Add / Update Month File: send 'Month Label | Google Sheet ID or URL'.",
      "- List Month Files: shows Active/Inactive status.",
      "- Remove Month File: permanently deletes month mapping.",
      "- Hide/Show Month File: toggles whether month appears in /start.",
    );
  }

  if (canUseDatabaseCheck) {
    lines.push(
      "",
      "Database Check flow (admin):",
      "1) /start -> Database Check.",
      "2) Choose Upload CRM Excel, then send .xlsx/.xls file.",
      "3) Bot validates comments/status rules from Google Sheet rules.",
      "4) Bot returns summary + output Excel with flagged rows only.",
      "",
      "Database Check admin actions:",
      "- List Rules",
      "- Show Admins",
      "- Add/Remove Positive Keyword (send: Status | keyword)",
      "- Add/Remove Negative Keyword (send: Status | keyword)",
    );
  }

  if (isAdmin) {
    lines.push(
      "",
      "Admin diagnostics:",
      "- /debug_totals -> choose month -> reconciliation report + CSV exports.",
      "- /debug (or /diagnostic, /sheets): Google Sheets connection diagnostics.",
    );
  }

  lines.push(
    "",
    "Tip: if you get stuck in any submenu, type /start to reset navigation.",
  );

  return lines.join("\n");
}
