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
  normalizeApprovedDepositAccId,
  resolveApprovedDepositsKycSources,
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

test("normalizeApprovedDepositAccId prefixes numeric IDs with ACC", () => {
  assert.equal(normalizeApprovedDepositAccId("423460"), "ACC423460");
  assert.equal(normalizeApprovedDepositAccId(" ACC423460 "), "ACC423460");
  assert.equal(normalizeApprovedDepositAccId("ACC387910!"), "ACC387910");
  assert.equal(normalizeApprovedDepositAccId("ACC-387910"), "ACC387910");
  assert.equal(normalizeApprovedDepositAccId("ミドリ 中村 | ACC387910 | MIRROX JP AE"), "ACC387910");
});

test("resolveApprovedDepositsKycSources defaults to all office KYC sheets", () => {
  const sources = resolveApprovedDepositsKycSources({});
  assert.equal(sources.length, 5);
  assert.equal(sources.some((source) => source.office === "Turkiye"), true);
  assert.equal(sources.some((source) => source.office === "Dubai"), true);
});

test("loadApprovedDepositsReport joins language across multiple KYC office sheets", async () => {
  const valuesByRange = new Map([
    [
      "'JULY'!A:L",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["17.07.2026", "ACC387910!", "17.07.2026", "Turkey Japanese", "Japan", "Agent A", "Mirrox", "Index", "9. Language: Japanese\nAmount: $250"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [387910, "HQ / AE / JP-TR / Opening / Team", "Approved", 250, "Fintech360", "Credit Card", "JCB-Portinax", "7/17/2026 8:46", "Yes", "Japan", "Index", "7/17/2026 8:46", "Mirrox"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Turkiye", spreadsheetId: "kyc-turkiye" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-turkiye" ? ["Checker", "JULY"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.totalAmount, 250);
  assert.equal(report.totals.Native.amount, 250);
  assert.equal(report.kycOfficeSources[0].matchedCount, 1);
});

test("loadApprovedDepositsReport uses FTD amount rows and joins KYC language by ACC ID", async () => {
  const valuesByRange = new Map([
    [
      "'JANUARY'!A:L",
      [
        ["JUNE KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["01.01.2026", "ACC423460", "01.01.2026", "Turkey English", "Vietnam", "Agent A", "Brand", "Aff", "Language: Vietnamese\nAmount: $999"],
        ["02.01.2026", "ACC423216", "02.01.2026", "Turkey English", "Vietnam", "Agent B", "Brand", "Aff", "Language: English\nAmount: $999"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [423460, "HQ / TR1 / ENAF-IB / Opening / Team", "Approved", 200, "Fintech360", "APM", "apay Airtel Uga", "7/17/2026 17:34", "Yes", "Vietnam", "Audi", "7/17/2026 17:34", "Fintana"],
        [423216, "HQ / TR1 / ENAF-IB / Opening / Team", "Approved", "202.4", "Fintech360", "APM", "CryptoPayx", "7/17/2026 17:06", "Yes", "Vietnam", "Bentley", "7/17/2026 17:26", "Fintana"],
        [423333, "HQ / TR1 / ENAF-IB / Opening / Team", "Pending", 50, "Fintech360", "Credit Card", "CryptoPayx", "7/17/2026 17:06", "No", "Vietnam", "BMaster", "7/17/2026 17:26", "OtherBrand"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSpreadsheetId: "kyc-sheet-id",
      amountSpreadsheetId: "amount-sheet-id",
      kycSheetTitles: ["Checker", "JANUARY", "JANUARY SELF"],
      amountSheetTitles: ["ALL"],
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.deepEqual(report.sourceTabs, ["ALL"]);
  assert.deepEqual(report.kycSourceTabs, ["KYC:JANUARY"]);
  assert.equal(report.totalAmount, 452.4);
  assert.equal(report.totals.Native.amount, 200);
  assert.equal(report.totals.English.amount, 202.4);
  assert.equal(report.totals.Other.amount, 50);
  assert.equal(report.options.brands.includes("Fintana"), true);
  assert.equal(report.countries.find((row) => row.country === "Vietnam").total.Native.count, 1);

  const filtered = await loadApprovedDepositsReport(
    { status: "Approved,Pending", campaign: "Audi,BMaster", brand: "Fintana" },
    {
      kycSpreadsheetId: "kyc-sheet-id",
      amountSpreadsheetId: "amount-sheet-id",
      kycSheetTitles: ["Checker", "JANUARY", "JANUARY SELF"],
      amountSheetTitles: ["ALL"],
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );
  assert.equal(filtered.totalAmount, 200);
  assert.equal(filtered.totalCount, 1);
});

