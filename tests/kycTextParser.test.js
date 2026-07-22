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
  parseApprovedDepositMonthTab,
  resolveApprovedDepositsKycSources,
  buildOtherLanguageAudit,
  otherLanguageReason,
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

test("validApprovedDepositTabTitles includes plain and year-suffixed month tabs", () => {
  assert.deepEqual(
    validApprovedDepositTabTitles(["Checker", "JANUARY", "JUNE SELF", "JULY", "MAY SELF", "MARCH"]),
    ["JANUARY", "MARCH", "JULY"],
  );
  assert.deepEqual(
    validApprovedDepositTabTitles(["Checker", "JULY26", "JUNE26", "January26", "Self July26", "JULY", "AUGUST26"]),
    ["January26", "JUNE26", "JULY26", "JULY", "AUGUST26"],
  );
});

test("parseApprovedDepositMonthTab recognizes office KYC tab naming styles", () => {
  assert.equal(parseApprovedDepositMonthTab("JULY26")?.key, "july");
  assert.equal(parseApprovedDepositMonthTab("JUNE26")?.key, "june");
  assert.equal(parseApprovedDepositMonthTab("January26")?.key, "january");
  assert.equal(parseApprovedDepositMonthTab("July 26")?.key, "july");
  assert.equal(parseApprovedDepositMonthTab("AUGUST26")?.key, "august");
  assert.equal(parseApprovedDepositMonthTab("DECEMBER26")?.key, "december");
  assert.equal(parseApprovedDepositMonthTab("JULY")?.key, "july");
  assert.equal(parseApprovedDepositMonthTab("Self July26"), null);
  assert.equal(parseApprovedDepositMonthTab("Checker"), null);
});

test("otherLanguageReason explains missing KYC vs unmapped language", () => {
  assert.equal(otherLanguageReason({ language: "Unknown", kycOffice: "" }), "No KYC match");
  assert.equal(otherLanguageReason({ language: "Unknown", kycOffice: "Dubai" }), "KYC matched but language missing");
  assert.equal(otherLanguageReason({ language: "French", kycOffice: "Dubai" }), "Unmapped language: French");
});

test("buildOtherLanguageAudit groups Other CIDs by month column", () => {
  const audit = buildOtherLanguageAudit(
    [
      {
        accId: "ACC100",
        brand: "Fintana",
        department: "HQ / AR / Opening / Team",
        country: "Mexico",
        language: "Unknown",
        kycOffice: "",
        languageCategory: "Other",
        monthKey: "2026-07",
        amount: 120,
      },
      {
        accId: "ACC100",
        brand: "Fintana",
        department: "HQ / AR / Opening / Team",
        country: "Mexico",
        language: "Unknown",
        kycOffice: "",
        languageCategory: "Other",
        monthKey: "2026-07",
        amount: 30,
      },
      {
        accId: "ACC200",
        brand: "Mirrox",
        department: "HQ / CL / Opening / Team",
        country: "Chile",
        language: "German",
        kycOffice: "Argentina",
        languageCategory: "Other",
        monthKey: "2026-06",
        amount: 80,
      },
      {
        accId: "ACC300",
        country: "India",
        language: "Hindi",
        kycOffice: "Turkiye",
        languageCategory: "Native",
        monthKey: "2026-07",
        amount: 500,
      },
    ],
    [
      { key: "2026-07", label: "Jul 2026" },
      { key: "2026-06", label: "Jun 2026" },
    ],
  );
  assert.equal(audit.uniqueCidCount, 2);
  assert.equal(audit.columns[0].monthKey, "2026-07");
  assert.equal(audit.columns[0].entries.length, 1);
  assert.equal(audit.columns[0].entries[0].cid, "ACC100");
  assert.equal(audit.columns[0].entries[0].brand, "Fintana");
  assert.equal(audit.columns[0].entries[0].department, "HQ / AR / Opening / Team");
  assert.equal(audit.columns[0].entries[0].amount, 150);
  assert.equal(audit.columns[0].entries[0].count, 2);
  assert.equal(audit.columns[1].entries[0].cid, "ACC200");
  assert.equal(audit.columns[1].entries[0].reason, "Unmapped language: German");
});

test("loadApprovedDepositsReport reads language from year-suffixed KYC tabs", async () => {
  const valuesByRange = new Map([
    [
      "'JULY26'!A:Z",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["01.07.2026", "ACC390721", "24.06.2026", "AR2-Portuguese", "Brazil", "Agent A", "Fintana", "Toptech", "8) Language: Portuguese"],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [390721, "HQ / AR / Opening / Team", "Approved", 4205, "Fintech360", "APM", "Pay", "7/1/2026 8:46", "Yes", "Brazil", "Camp", "7/1/2026 8:46", "Fintana"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Argentina", spreadsheetId: "kyc-argentina" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-argentina" ? ["Checker", "JULY26"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.deepEqual(report.kycSourceTabs, ["Argentina:JULY26"]);
  assert.equal(report.totalAmount, 4205);
  assert.equal(report.totals.Native.amount, 4205);
  assert.equal(report.rows[0].language, "Portuguese");
  assert.equal(report.rows[0].kycOffice, "Argentina");
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

test("parseKycLanguageParts handles extra spaces and accented language labels", () => {
  assert.deepEqual(parseKycLanguageParts("Language:    German"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("Lang:    French"), ["French"]);
  assert.deepEqual(parseKycLanguageParts("10. Language :    German"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("Language:\nGerman"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("Language: Français"), ["French"]);
  assert.deepEqual(parseKycLanguageParts("Language: Deutsch"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("Language: Italiano"), ["Italian"]);
  assert.deepEqual(parseKycLanguageParts("Language: Español"), ["Spanish"]);
  assert.deepEqual(parseKycLanguageParts("Language: German 10/10"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("9. Language: German 10/10"), ["German"]);
  assert.deepEqual(parseKycLanguageParts("Language: English/French"), ["English", "French"]);
  assert.deepEqual(parseKycLanguageParts("Language:    "), []);
  assert.deepEqual(parseKycLanguageParts("8) Language:    "), []);
});

test("parseKycLanguageParts keeps both languages from comma and annotation lists", () => {
  assert.deepEqual(parseKycLanguageParts("Language: Arabic (native), English (fluent)"), ["Arabic", "English"]);
  assert.deepEqual(parseKycLanguageParts("Language: German (native), English (B2)"), ["German", "English"]);
  assert.deepEqual(parseKycLanguageParts("Language: English + Arabic"), ["English", "Arabic"]);
  assert.deepEqual(parseKycLanguageParts("Language: Deutsch & Englisch"), ["German", "English"]);
  assert.deepEqual(parseKycLanguageParts("Language: English B2"), ["English"]);
  assert.deepEqual(parseKycLanguageParts("Language: Ger"), ["German"]);
});

test("parseKycLanguageParts drops placeholder language values", () => {
  assert.deepEqual(parseKycLanguageParts("Language: N/A"), []);
  assert.deepEqual(parseKycLanguageParts("Language: -"), []);
  assert.deepEqual(parseKycLanguageParts("Language: TBD"), []);
  assert.deepEqual(parseKycLanguageParts("Language: none"), []);
  assert.deepEqual(parseKycLanguageParts("Language: x"), []);
});

test("native indicator values count as the country's native language", () => {
  assert.deepEqual(parseKycLanguageParts("Language: Native"), ["Native language"]);
  assert.deepEqual(parseKycLanguageParts("Language: mother tongue"), ["Native language"]);
  assert.equal(
    categorizeKycLanguages({ country: "Thailand", languages: parseKycLanguageParts("Language: local") }),
    "Native",
  );
  assert.equal(
    categorizeKycLanguages({ country: "Thailand", languages: parseKycLanguageParts("Language: Native & English") }),
    "English & Native",
  );
  assert.equal(
    categorizeKycLanguages({ country: "Unknown", languages: parseKycLanguageParts("Language: Native") }),
    "Other",
  );
});

test("Switzerland German and French map to Native using country aliases and KYC country", () => {
  assert.equal(categorizeKycLanguages({ country: "Switzerland", languages: ["German"] }), "Native");
  assert.equal(categorizeKycLanguages({ country: "Switzerland", languages: ["French"] }), "Native");
  assert.equal(categorizeKycLanguages({ country: "CH", languages: ["German"] }), "Native");
  assert.equal(categorizeKycLanguages({ country: "Suisse", languages: ["French"] }), "Native");
  assert.equal(
    categorizeKycLanguages({
      country: "Germany",
      kycCountry: "Switzerland",
      languages: parseKycLanguageParts("Language:    German"),
    }),
    "Native",
  );
  assert.equal(
    categorizeKycLanguages({
      country: "France",
      kycCountry: "Schweiz",
      languages: parseKycLanguageParts("Lang:    French"),
    }),
    "Native",
  );
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

test("lookupKycLanguageRecord dedupes identical KYC rows across offices", () => {
  const index = createKycLanguageIndex();
  addKycLanguageRecord(index, { office: "Turkiye", cid: "ACC70683", country: "United Arab Emirates", language: "English" });
  addKycLanguageRecord(index, { office: "Dubai", cid: "ACC70683", country: "United Arab Emirates", language: "English" });

  const match = lookupKycLanguageRecord(index, { accId: "ACC70683", country: "United Arab Emirates" });
  assert.equal(match?.language, "English");
  assert.ok(["Turkiye", "Dubai"].includes(match?.office));
});

test("lookupKycLanguageRecord matches ACC ID together with LIST OF COUNTRYS", () => {
  const index = createKycLanguageIndex();
  addKycLanguageRecord(index, { office: "Turkiye", cid: "ACC123456", country: "Vietnam", language: "Vietnamese" });
  addKycLanguageRecord(index, { office: "Turkiye", cid: "ACC123456", country: "Japan", language: "Japanese" });

  assert.equal(lookupKycLanguageRecord(index, { accId: "123456", country: "Japan" })?.language, "Japanese");
  assert.equal(lookupKycLanguageRecord(index, { accId: "ACC123456", country: "Vietnam" })?.language, "Vietnamese");
  assert.equal(lookupKycLanguageRecord(index, { accId: "ACC123456", country: "Thailand" }), null);
});

test("loadApprovedDepositsReport joins numbered KYC blocks with English for UAE", async () => {
  const kycBlock = [
    "1. Registration Date: 2026-07-02",
    "8. Country: United Arab Emirates",
    "9. Language: English",
    "26. Comments: ready to start.",
    "CID : ACC70784",
  ].join("\n");
  const valuesByRange = new Map([
    [
      "'JULY26'!A:Z",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["02.07.2026", "ACC70683", "02.07.2026", "Turkey English", "United Arab Emirates", "Agent A", "Riverquode", "Fiat", kycBlock],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [70683, "HQ / TR1 / EN / Opening / Elham", "Approved", 1000, "Fintech360", "Credit Card", "Pay", "7/2/2026 8:46", "Yes", "United Arab Emirates", "Fiat", "7/2/2026 8:46", "Riverquode"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [
        { office: "Turkiye", spreadsheetId: "kyc-turkiye" },
        { office: "Dubai", spreadsheetId: "kyc-dubai" },
      ],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => {
        if (spreadsheetId === "kyc-turkiye" || spreadsheetId === "kyc-dubai") {
          return ["JULY26"];
        }
        return ["ALL"];
      },
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.rows[0].accId, "ACC70683");
  assert.equal(report.rows[0].language, "English");
  assert.equal(report.rows[0].languageCategory, "English");
  assert.equal(report.rows[0].kycOffice, "Turkiye");
  assert.equal(report.totals.English.amount, 1000);
  assert.equal(report.otherLanguageAudit.uniqueCidCount, 0);
});

test("loadApprovedDepositsReport reads Switzerland German ratings from numbered KYC blocks", async () => {
  const kycBlock = [
    "Muller Maria | ACC72189",
    "8. Country: Switzerland",
    "9. Language: German 10/10",
    "10. Citizenship: Swiss",
  ].join("\n");
  const valuesByRange = new Map([
    [
      "'JULY26'!A:Z",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNTRYS", "Agents", "BRAND", "AFF", "KYC"],
        ["06.07.2026", "ACC72189", "06.07.2026", "Turkey German", "Switzerland", "Ali Da", "Riverquode", "Axiom", kycBlock],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [72189, "HQ / TR1 / GE / Opening / Aaron", "Approved", 571.98, "Fintech360", "Credit Card", "Pay", "7/6/2026 8:46", "Yes", "Switzerland", "Axiom", "7/6/2026 8:46", "Riverquode"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Turkiye", spreadsheetId: "kyc-turkiye" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-turkiye" ? ["JULY26"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.rows[0].language, "German");
  assert.equal(report.rows[0].languageCategory, "Native");
  assert.equal(report.totals.Native.amount, 571.98);
  assert.equal(report.otherLanguageAudit.uniqueCidCount, 0);
});

test("loadApprovedDepositsReport reads language when the KYC column is unlabeled", async () => {
  const kycBlock = [
    "1. CID: ACC72577",
    "10. Country: Switzerland",
    "12. Language: German",
  ].join("\n");
  const valuesByRange = new Map([
    [
      "'JULY26'!A:Z",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "RegistrationDate", "Department / Office", "LIST OF COUNRTYS", "Agents", "BRAND", "AFF", "", "SEC PSW", "Eng", "BONUS"],
        ["07.07.2026", "ACC72577", "07.07.2026", "Turkey German", "Switzerland", "Eda Ci", "Riverquode", "Bugatti", kycBlock, "2577", "", ""],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [72577, "HQ / TR1 / GE / Opening / Aaron", "Approved", 572, "Fintech360", "Credit Card", "Pay", "7/7/2026 8:46", "Yes", "Switzerland", "Bugatti", "7/7/2026 8:46", "Riverquode"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Turkiye", spreadsheetId: "kyc-turkiye" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-turkiye" ? ["JULY26"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.rows[0].language, "German");
  assert.equal(report.rows[0].languageCategory, "Native");
  assert.equal(report.rows[0].kycOffice, "Turkiye");
  assert.equal(report.otherLanguageAudit.uniqueCidCount, 0);
});

test("loadApprovedDepositsReport treats country-name language values as native", async () => {
  const kycBlock = [
    "1. CID: ACC296554",
    "8. Country: Indonesia",
    "9. Preferred Language: INDONESIA",
    "10. English Proficiency (10%-100%): 30%",
  ].join("\n");
  const valuesByRange = new Map([
    [
      "'JULY26'!A:Z",
      [
        ["JULY KYC"],
        ["FTD Date", "CID", "Registration Date", "TXN", "Department / Office", "LIST OF COUNRTYS", "Agents", "BRAND", "AFF", "KYC"],
        ["03.07.2026", "ACC296554", "03.07.2026", "TXN254461", "AE Indonesia", "Indonesia", "Ryan Pr", "Spova", "Fiat", kycBlock],
      ],
    ],
    [
      "'ALL'!A:Z",
      [
        ["ACC ID", "Original Department", "Status", "USD Amount", "Cashier", "Method", "Cleared By", "Created", "FTD", "Country", "Campaign", "Approved", "Brand"],
        [296554, "HQ / AE / ID / Opening / Team5", "Approved", 300, "Fintech360", "APM", "Pay", "7/3/2026 8:46", "Yes", "Indonesia", "Fiat", "7/3/2026 8:46", "Spova"],
      ],
    ],
  ]);

  const report = await loadApprovedDepositsReport(
    {},
    {
      kycSources: [{ office: "Dubai", spreadsheetId: "kyc-dubai" }],
      amountSpreadsheetId: "amount-sheet-id",
      amountSheetTitles: ["ALL"],
      getSheetTitles: async (spreadsheetId) => (spreadsheetId === "kyc-dubai" ? ["JULY26"] : ["ALL"]),
      readValues: async (_spreadsheetId, range) => valuesByRange.get(range) || [],
    },
  );

  assert.equal(report.rows[0].language, "Indonesian");
  assert.equal(report.rows[0].languageCategory, "Native");
  assert.equal(report.otherLanguageAudit.uniqueCidCount, 0);
});

test("loadApprovedDepositsReport disambiguates similar ACC IDs by country", async () => {
  const valuesByRange = new Map([
    [
      "'JULY'!A:Z",
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
      "'JULY'!A:Z",
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
      "'JULY'!A:Z",
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
      "'JANUARY'!A:Z",
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
  assert.equal(report.otherLanguageAudit.uniqueCidCount, 1);
  assert.equal(report.otherLanguageAudit.columns[0].entries[0].cid, "ACC423333");
  assert.equal(report.otherLanguageAudit.columns[0].entries[0].reason, "No KYC match");

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
      "'JULY'!A:Z",
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
