#!/usr/bin/env node
import { runQuickReportAudit } from "../lib/quickReportAuditRunner.js";
import { QUICK_REPORT_PRESET_KEYS } from "../lib/quickReportPresets.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((token) => {
    const [key, ...rest] = token.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "1"];
  }),
);

const offices = String(args.office || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const presets = String(args.preset || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const monthKey = String(args.monthKey || "").trim();
const maxRuns = Number(args.maxRuns || 40);

const result = await runQuickReportAudit({
  offices,
  presets: presets.length ? presets : QUICK_REPORT_PRESET_KEYS,
  monthKey,
  maxRuns,
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
