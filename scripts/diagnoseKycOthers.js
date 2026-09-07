#!/usr/bin/env node
// Diagnoses why Approved Deposits rows fall into the "Other" language bucket.
//
// It reads EVERY configured KYC office sheet, parses the language of every KYC
// row, and prints a breakdown of the reasons rows are classified as Other plus
// the exact raw language strings that are still unmapped.
//
// Usage (needs Google Sheets credentials in the environment):
//   node scripts/diagnoseKycOthers.js
//   node scripts/diagnoseKycOthers.js --json > kyc-diagnosis.json
//
// Credentials are read the same way as the app (GOOGLE_PRIVATE_KEY /
// GOOGLE_SERVICE_ACCOUNT_JSON, etc). See .env.example.

import { diagnoseKycLanguages } from "../lib/approvedDepositsService.js";

function formatEntry({ value, count }) {
  return `  ${String(count).padStart(6)}  ${value}`;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const result = await diagnoseKycLanguages();

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const { totals, byCategory, otherReasons } = result;
  console.log("KYC language diagnosis");
  console.log("======================");
  console.log(`Generated at: ${result.generatedAt}`);
  console.log(`KYC rows scanned (with CID): ${totals.withCid}`);
  console.log("");

  console.log("Category breakdown:");
  for (const [category, count] of Object.entries(byCategory)) {
    const share = totals.withCid ? ((count / totals.withCid) * 100).toFixed(1) : "0.0";
    console.log(`  ${category.padEnd(18)} ${String(count).padStart(6)}  (${share}%)`);
  }
  console.log("");

  console.log("Why rows are Other:");
  console.log(`  No language label found : ${otherReasons.noLanguageLabel}`);
  console.log(`  Placeholder only        : ${otherReasons.placeholderOnly}`);
  console.log(`  Unmapped language value : ${otherReasons.unmappedLanguage}`);
  console.log(`  Unknown country         : ${otherReasons.unknownCountry}`);
  console.log("");

  console.log("Top unmapped language values (add these to the alias tables):");
  for (const entry of result.topUnmappedLanguages) {
    console.log(formatEntry(entry));
    const sample = entry.samples?.[0];
    if (sample) {
      console.log(`          e.g. CID ${sample.cid} / ${sample.country} / ${sample.office}`);
    }
  }
  console.log("");

  console.log("Top countries with rows that have NO language label:");
  for (const entry of result.topNoLabelCountries) {
    console.log(formatEntry(entry));
  }
  console.log("");

  console.log("Top countries in the Other bucket overall:");
  for (const entry of result.topOtherCountries) {
    console.log(formatEntry(entry));
  }
  console.log("");

  console.log("Per office / tab coverage:");
  for (const office of result.offices) {
    if (office.error) {
      console.log(`  ${office.office}: ERROR ${office.error}`);
      continue;
    }
    console.log(`  ${office.office}: ${office.rows} rows, ${office.other} other`);
    for (const tab of office.tabs) {
      if (tab.error) {
        console.log(`      ${tab.title}: ERROR ${tab.error}`);
      } else if (tab.skipped) {
        console.log(`      ${tab.title}: skipped (${tab.skipped})`);
      } else {
        console.log(`      ${tab.title}: ${tab.rows} rows`);
      }
    }
  }
}

main().catch((error) => {
  console.error("Diagnosis failed:", error?.message || error);
  process.exitCode = 1;
});
