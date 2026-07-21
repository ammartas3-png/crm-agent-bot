import assert from "node:assert/strict";
import test from "node:test";

import {
  categorizeKycLanguage,
  categorizeKycLanguages,
  parseKycAmount,
  parseKycLanguage,
  parseKycLanguageParts,
  parseKycText,
} from "../lib/kycTextParser.js";
import {
  loadApprovedDepositsReport,
  lookupKycLanguageRecord,
  normalizeApprovedDepositAccId,
  createKycLanguageIndex,
  addKycLanguageRecord,
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

test("Chile language values map to expected categories", () => {
  assert.equal(categorizeKycLanguages({ country: "Chile", languages: ["Spanish"] }), "Native");
  assert.equal(categorizeKycLanguages({ country: "Chile", languages: ["English"] }), "English");
  assert.equal(
    categorizeKycLanguages({ country: "Chile", languages: parseKycLanguageParts("Language: English & Spanish") }),
    "English & Native",
  );
  assert.equal(parseKycLanguage("Language: ES"), "Spanish");
  assert.equal(parseKycLanguage("Language: Espanol"), "Spanish");
});

test("parseKycLanguageParts supports bilingual values as English & Native", () => {
  assert.deepEqual(parseKycLanguageParts("7.Language: English & Malay"), ["English", "Malay"]);
  assert.equal(parseKycLanguage("9. Language: EN"), "English");
  assert.equal(
    categorizeKycLanguages({ country: "Malaysia", languages: ["English", "Malay"] }),
    "English & Native",
  );
  assert.equal(categorizeKycLanguage({ country: "Malaysia", language: "English & Malay" }), "English & Native");
});

test("lookupKycLanguageRecord matches ACC ID together with LIST OF COUNTRYS", () => {
  const index = createKycLanguageIndex();
  addKycLanguageRecord(index, { office: "Turkiye", cid: "ACC123456", country: "Vietnam", language: "Vietnamese" });
  addKycLanguageRecord(index, { office: "Turkiye", cid: "ACC123456", country: "Japan", language: "Japanese" });

  assert.equal(lookupKycLanguageRecord(index, { accId: "123456", country: "Japan" })?.language, "Japanese");
  assert.equal(lookupKycLanguageRecord(index, { accId: "ACC123456", country: "Vietnam" })?.language, "Vietnamese");
  assert.equal(lookupKycLanguageRecord(index, { accId: "ACC123456", country: "Thailand" }), null);
});

test("loadApprovedDepositsReport disambiguates similar ACC IDs by country", async () => {
  const valuesByRange = new Map([
    [
      "'JULY'!A:L",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["17.07.2026", "ACC123456", "17.07.2026", "Turkey English", "Vietnam", "Agent A", "Brand", "Aff", "Language: Vietnamese"],
        ["17.07.2026", "ACC123456", "17.07.2026", "Turkey Japanese", "Japan", "Agent B", "Brand", "Aff", "Language: Japanese"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [123456, "HQ / AE / JP-TR / Opening / Team", "Approved", 250, "Fintech360", "Credit Card", "JCB", "7/17/2026 8:46", "Yes", "Japan", "Index", "7/17/2026 8:46", "Mirrox"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Turkiye", spreadsheetId: "kyc-turkiye" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-turkiye" ? ["JULY"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.totals.Native.amount, 250);
  assert.equal(report.rows[0].language, "Japanese");
});

test("loadApprovedDepositsReport reads country from misspelled LIST OF COUNRTYS header", async () => {
  const valuesByRange = new Map([
    [
      "'JULY'!A:L",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNRTYS", "Agents", "BRAND", "AFF", "KYC"],
        ["17.07.2026", "ACC123456", "17.07.2026", "Turkey English", "Vietnam", "Agent A", "Brand", "Aff", "Language: Vietnamese"],
        ["17.07.2026", "ACC123456", "17.07.2026", "Turkey Japanese", "Japan", "Agent B", "Brand", "Aff", "Language: Japanese"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [123456, "HQ / AE / JP-TR / Opening / Team", "Approved", 250, "Fintech360", "Credit Card", "JCB", "7/17/2026 8:46", "Yes", "Japan", "Index", "7/17/2026 8:46", "Mirrox"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Turkiye", spreadsheetId: "kyc-turkiye" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-turkiye" ? ["JULY"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.rows[0].country, "Japan");
  assert.equal(report.rows[0].language, "Japanese");
  assert.equal(report.totals.Native.amount, 250);
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

test("loadApprovedDepositsReport keeps CID matches scoped to selected KYC office", async () => {
  const valuesByRange = new Map([
    [
      "'JULY'!A:L",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["17.07.2026", "ACC555001", "17.07.2026", "Turkey English", "Malaysia", "Agent A", "Brand", "Aff", "Language: English & Malay"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [555001, "HQ / AE / MY / Opening / Team", "Approved", 200, "Fintech360", "APM", "Pay", "7/17/2026 8:46", "Yes", "Malaysia", "Fiat-MY", "7/17/2026 8:46", "Spova"],
      ],
    ],
  ]);

  const turkiyeReport = await loadApprovedDepositsReport(
    { office: "Turkiye" },
    {
      kycSources: [
        { office: "Turkiye", spreadsheetId: "kyc-turkiye" },
        { office: "Dubai", spreadsheetId: "kyc-dubai" },
      ],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => {
        if (spreadsheetId === "kyc-turkiye") {
          return ["JULY"];
        }
        if (spreadsheetId === "kyc-dubai") {
          return [];
        }
        return ["ALL"];
      },
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  const dubaiReport = await loadApprovedDepositsReport(
    { office: "Dubai" },
    {
      kycSources: [
        { office: "Turkiye", spreadsheetId: "kyc-turkiye" },
        { office: "Dubai", spreadsheetId: "kyc-dubai" },
      ],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => {
        if (spreadsheetId === "kyc-turkiye") {
          return ["JULY"];
        }
        if (spreadsheetId === "kyc-dubai") {
          return [];
        }
        return ["ALL"];
      },
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(turkiyeReport.totalCount, 1);
  assert.equal(turkiyeReport.rows[0].kycOffice, "Turkiye");
  assert.equal(turkiyeReport.rows[0].languageCategory, "English & Native");
  assert.equal(dubaiReport.totalCount, 0);
});
