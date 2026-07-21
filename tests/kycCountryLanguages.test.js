import assert from "node:assert/strict";
import test from "node:test";

import { categorizeKycLanguage, categorizeKycLanguages, parseKycLanguageParts } from "../lib/kycTextParser.js";
import { nativeLanguagesForCountry, normalizeKycCountry } from "../lib/kycCountryLanguages.js";

const COUNTRY_CASES = [
  { country: "UAE", language: "Arabic", category: "Native", normalized: "United Arab Emirates" },
  { country: "United Arab Emirates", language: "AR", category: "Native" },
  { country: "Pakistan", language: "Urdu", category: "Native" },
  { country: "Tunisia", language: "French", category: "Native" },
  { country: "Tunisia", language: "Arabic", category: "Native" },
  { country: "Kenya", language: "Swahili", category: "Native" },
  { country: "Kenya", language: "English", category: "English" },
  { country: "Singapore", language: "EN", category: "English" },
  { country: "Singapore", language: "Chinese", category: "Native" },
  { country: "Brazil", language: "Portuguese", category: "Native" },
  { country: "Brazil", language: "PT", category: "Native" },
  { country: "Germany", language: "German", category: "Native" },
  { country: "South Korea", language: "Korean", category: "Native" },
  { country: "Korea", language: "KR", category: "Native", normalized: "South Korea" },
  { country: "Ivory Coast", language: "French", category: "Native", normalized: "Cote D'Ivoire" },
  { country: "Chile", language: "Spanish", category: "Native" },
  { country: "Malaysia", language: "English & Malay", category: "English & Native" },
  { country: "India", language: "Hindi", category: "Native" },
  { country: "India", language: "English & Hindi", category: "English & Native" },
  { country: "Japan", language: "Japanese", category: "Native" },
  { country: "Grenada", language: "English", category: "English" },
  { country: "Nigeria", language: "Hausa", category: "Native" },
  { country: "Nigeria", language: "English", category: "English" },
  { country: "Turkey", language: "Turkish", category: "Native", normalized: "Turkiye" },
];

test("normalizeKycCountry resolves common aliases", () => {
  assert.equal(normalizeKycCountry("UAE"), "United Arab Emirates");
  assert.equal(normalizeKycCountry("uae"), "United Arab Emirates");
  assert.equal(normalizeKycCountry("Ivory Coast"), "Cote D'Ivoire");
  assert.equal(normalizeKycCountry("South Korea"), "South Korea");
  assert.equal(normalizeKycCountry("turkey"), "Turkiye");
});

test("country language matrix maps native and english categories", () => {
  for (const item of COUNTRY_CASES) {
    const country = item.normalized || item.country;
    const languages = parseKycLanguageParts(`Language: ${item.language}`);
    const category = categorizeKycLanguages({ country, languages });
    assert.equal(
      category,
      item.category,
      `${item.country} + ${item.language} expected ${item.category}, got ${category}`,
    );
  }
});

test("nativeLanguagesForCountry returns local languages without English", () => {
  assert.deepEqual(nativeLanguagesForCountry("Kenya"), ["Swahili"]);
  assert.deepEqual(nativeLanguagesForCountry("Singapore"), ["Malay", "Chinese"]);
  assert.deepEqual(nativeLanguagesForCountry("United Kingdom"), []);
});

test("unknown country with only english maps to English", () => {
  assert.equal(categorizeKycLanguage({ country: "Antarctica", language: "English" }), "English");
});
