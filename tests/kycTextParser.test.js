import assert from "node:assert/strict";
import test from "node:test";

import {
  categorizeKycLanguage,
  parseKycAmount,
  parseKycLanguage,
  parseKycText,
} from "../lib/kycTextParser.js";
import {
  loadApprovedDepositsReport,
  validApprovedDepositTabTitles,
} from "../lib/approvedDepositsService.js";

test("parseKycText extracts language, amount, and language category", () => {
  const parsed = parseKycText("10. Language: Thai\n18. Approved Deposit Amount: $1,250.50", {
    country: "Thailand",
  });

  assert.equal(parsed.language, "Thai");
  assert.equal(parsed.languageCategory, "Native");
  assert.equal(parsed.amount, 1250.5);
});

test("categorizeKycLanguage maps English separately from native language", () => {
  assert.equal(categorizeKycLanguage({ country: "Vietnam", language: "Vietnamese" }), "Native");
  assert.equal(categorizeKycLanguage({ country: "Vietnam", language: "English" }), "English");
  assert.equal(categorizeKycLanguage({ country: "Vietnam", language: "French" }), "Other");
});

test("parseKycAmount supports labelled and currency-prefixed amounts", () => {
  assert.equal(parseKycAmount("Amount: USD 2,500"), 2500);
  assert.equal(parseKycAmount("Deposit $3.400,75 confirmed"), 3400.75);
});

test("parseKycLanguage reads labelled language values", () => {
  assert.equal(parseKycLanguage("Customer Language: Tagalog\nAmount: 500"), "Filipino");
});

test("validApprovedDepositTabTitles only includes plain month tabs", () => {
  assert.deepEqual(
    validApprovedDepositTabTitles(["Checker", "JANUARY", "JUNE SELF", "JULY", "MAY SELF", "MARCH"]),
    ["JANUARY", "MARCH", "JULY"],
  );
});

test("loadApprovedDepositsReport aggregates approved deposits by category and month", async () => {
  const valuesByRange = new Map([
    [
      "'JANUARY'!A:L",
      [
        ["JUNE KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["01.01.2026", "CID1", "01.01.2026", "Turkey English", "Vietnam", "Agent A", "Brand", "Aff", "Language: Vietnamese\nAmount: $100"],
        ["02.01.2026", "CID2", "02.01.2026", "Turkey English", "Vietnam", "Agent B", "Brand", "Aff", "Language: English\nAmount: $300"],
      ],
    ],
    [
      "'JULY'!A:L",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["01.07.2026", "CID3", "01.07.2026", "Turkey English", "Thailand", "Agent C", "Brand", "Aff", "Language: Chinese\nAmount: $50"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      spreadsheetId: "sheet-id",
      sheetTitles: ["Checker", "JANUARY", "JANUARY SELF", "JULY"],
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.deepEqual(report.sourceTabs, ["JANUARY", "JULY"]);
  assert.equal(report.totalAmount, 450);
  assert.equal(report.totals.Native.amount, 100);
  assert.equal(report.totals.English.amount, 300);
  assert.equal(report.totals.Other.amount, 50);
  assert.equal(report.countries.find((row) => row.country === "Vietnam").total.Native.count, 1);
});

