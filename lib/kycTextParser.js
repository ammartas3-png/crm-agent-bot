import { normalizeText } from "./calculations.js";
import {
  LANGUAGE_ALIASES,
  isNativeLanguageForCountry,
  nativeLanguagesForCountry,
  normalizeKycCountry,
} from "./kycCountryLanguages.js";

const LANGUAGE_LABEL_PATTERN =
  /\b(?:language|lang|languages|customer\s+language|spoken\s+language)\b\s*[:=\-]\s*([^\n\r;|]+)/i;
const LANGUAGE_MULTILINE_PATTERN =
  /\b(?:language|lang|languages|customer\s+language|spoken\s+language)\b\s*[:=\-]\s*(?:\n|\r\n?)\s*([^\n\r;|]+)/i;
const AMOUNT_LABEL_PATTERN =
  /\b(?:approved\s+deposit|deposit\s+amount|amount|deposit|ftd)\s*[:=-]?\s*(?:usd|\$)?\s*([0-9][0-9\s.,]*)\b/i;
const CURRENCY_AMOUNT_PATTERN = /(?:usd|\$)\s*([0-9][0-9\s.,]*)\b/i;
const LANGUAGE_SPLIT_PATTERN = /\s*(?:&|,|\/|\+|\band\b)\s*/i;
const LANGUAGE_PROFICIENCY_PATTERN =
  /\s*(?:[-–]\s*)?(?:\(?\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)?|\(?\s*(?:native|fluent|basic|beginner|intermediate|advanced|[abc][12])\s*\)?|-\s*[abc][12])\s*$/i;
const PLACEHOLDER_LANGUAGE_TOKENS = new Set([
  "na",
  "n a",
  "tbd",
  "tba",
  "none",
  "no",
  "nil",
  "unknown",
  "unkown",
  "x",
  "xx",
  "-",
  "--",
  "?",
]);
const NATIVE_INDICATOR_TOKENS = new Set([
  "native",
  "nativelanguage",
  "native language",
  "local",
  "locallanguage",
  "local language",
  "mothertongue",
  "mother tongue",
]);

function compactText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function stripDiacritics(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

function normalizeLanguageCapture(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripLanguageAnnotations(value = "") {
  let text = normalizeLanguageCapture(value).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  while (text) {
    const stripped = text.replace(LANGUAGE_PROFICIENCY_PATTERN, "").trim();
    if (!stripped || stripped === text) {
      break;
    }
    text = stripped;
  }
  return text;
}

function normalizeLanguageToken(value = "") {
  return normalizeText(stripDiacritics(value))
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNumericLanguagePart(value = "") {
  return /^\d{1,2}$/.test(String(value || "").trim());
}

function isPlaceholderLanguagePart(value = "") {
  const token = normalizeLanguageToken(value);
  if (!token) {
    return true;
  }
  return PLACEHOLDER_LANGUAGE_TOKENS.has(token) || PLACEHOLDER_LANGUAGE_TOKENS.has(token.replace(/\s+/g, ""));
}

function isNativeIndicatorPart(value = "") {
  const token = normalizeLanguageToken(value);
  if (!token) {
    return false;
  }
  return NATIVE_INDICATOR_TOKENS.has(token) || NATIVE_INDICATOR_TOKENS.has(token.replace(/\s+/g, ""));
}

function canonicalLanguage(value = "") {
  const stripped = stripDiacritics(value);
  const normalized = normalizeText(stripped)
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  if (LANGUAGE_ALIASES.has(normalized)) {
    return LANGUAGE_ALIASES.get(normalized);
  }
  for (const [token, canonical] of LANGUAGE_ALIASES.entries()) {
    if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized)) {
      return canonical;
    }
  }
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasLanguageLabel(text = "") {
  return /\b(?:language|lang|customer\s+language|spoken\s+language)\b/i.test(text);
}

function languageLabelValue(value = "") {
  const text = compactText(value);
  if (!text) {
    return "";
  }
  const inlineMatch = text.match(LANGUAGE_LABEL_PATTERN);
  if (inlineMatch) {
    const captured = normalizeLanguageCapture(inlineMatch[1]);
    if (captured) {
      return captured;
    }
  }
  const multilineMatch = text.match(LANGUAGE_MULTILINE_PATTERN);
  if (multilineMatch) {
    const captured = normalizeLanguageCapture(multilineMatch[1]);
    if (captured) {
      return captured;
    }
  }
  if (hasLanguageLabel(text)) {
    return "";
  }
  return text;
}

function parseNumberToken(value = "") {
  let text = String(value || "")
    .replace(/\s+/g, "")
    .replace(/^[^\d-]+/, "")
    .replace(/[^\d.,-]+$/g, "");
  if (!text) {
    return 0;
  }
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    text = text.replace(new RegExp(`\\${thousandSeparator}`, "g"), "");
    text = text.replace(decimalSeparator, ".");
  } else if (lastComma > -1) {
    const [, decimals = ""] = text.split(",").slice(-2);
    text = decimals.length === 2 ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else {
    const parts = text.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length !== 2)) {
      text = text.replace(/\./g, "");
    }
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const NATIVE_LANGUAGE_PLACEHOLDER = "Native language";

export function parseKycLanguageParts(value = "") {
  const raw = stripLanguageAnnotations(languageLabelValue(value));
  if (!raw || isPlaceholderLanguagePart(raw)) {
    return isNativeIndicatorPart(raw) ? [NATIVE_LANGUAGE_PLACEHOLDER] : [];
  }
  const splitParts = raw
    .split(LANGUAGE_SPLIT_PATTERN)
    .map((part) => stripLanguageAnnotations(part))
    .filter(
      (part) =>
        part &&
        normalizeLanguageToken(part).replace(/\s+/g, "").length >= 2 &&
        !isNumericLanguagePart(part) &&
        !isPlaceholderLanguagePart(part),
    );
  const parts = splitParts
    .map((part) => (isNativeIndicatorPart(part) ? NATIVE_LANGUAGE_PLACEHOLDER : canonicalLanguage(part)))
    .filter(Boolean);
  if (parts.length) {
    return [...new Set(parts)];
  }
  if (isPlaceholderLanguagePart(raw)) {
    return [];
  }
  if (isNativeIndicatorPart(raw)) {
    return [NATIVE_LANGUAGE_PLACEHOLDER];
  }
  const fallback = canonicalLanguage(raw);
  return fallback ? [fallback] : [];
}

export function parseKycAmount(value = "") {
  const text = compactText(value);
  if (!text) {
    return 0;
  }
  const labelMatch = text.match(AMOUNT_LABEL_PATTERN);
  if (labelMatch) {
    return parseNumberToken(labelMatch[1]);
  }
  const currencyMatch = text.match(CURRENCY_AMOUNT_PATTERN);
  if (currencyMatch) {
    return parseNumberToken(currencyMatch[1]);
  }
  return 0;
}

export function parseKycLanguage(value = "") {
  return parseKycLanguageParts(value).join(" & ");
}

function isEnglishLanguage(language = "") {
  return normalizeText(language) === "english";
}

function languageIsNativeForCountries(language = "", ...countries) {
  const uniqueCountries = [
    ...new Set(
      countries
        .map((country) => normalizeKycCountry(country))
        .filter((country) => country && country !== "Unknown"),
    ),
  ];
  return uniqueCountries.some((country) => isNativeLanguageForCountry(language, country));
}

export function categorizeKycLanguages({ country = "", kycCountry = "", languages = [] } = {}) {
  const canonicalCountry = normalizeKycCountry(country);
  const canonicalKycCountry = normalizeKycCountry(kycCountry);
  const countryKnown = canonicalCountry !== "Unknown" || canonicalKycCountry !== "Unknown";
  const rawLanguages = (Array.isArray(languages) ? languages : []).filter(Boolean);
  const hasNativeIndicator = rawLanguages.some((language) => isNativeIndicatorPart(language));
  const canonicalLanguages = rawLanguages
    .filter((language) => !isNativeIndicatorPart(language))
    .map((language) => canonicalLanguage(language))
    .filter(Boolean);
  if (!canonicalLanguages.length && !hasNativeIndicator) {
    return "Other";
  }
  const hasEnglish = canonicalLanguages.some((language) => isEnglishLanguage(language));
  const hasNative =
    (hasNativeIndicator && countryKnown) ||
    canonicalLanguages.some((language) =>
      languageIsNativeForCountries(language, canonicalCountry, canonicalKycCountry),
    );
  if (hasEnglish && hasNative) {
    return "English & Native";
  }
  if (hasEnglish) {
    return "English";
  }
  if (hasNative) {
    return "Native";
  }
  return "Other";
}

export function categorizeKycLanguage({ country = "", kycCountry = "", language = "" } = {}) {
  const languages = Array.isArray(language)
    ? language
    : parseKycLanguageParts(String(language || "").includes("Language:") ? language : `Language: ${language}`);
  return categorizeKycLanguages({ country, kycCountry, languages });
}

export function parseKycText(value = "", context = {}) {
  const languages = parseKycLanguageParts(value);
  const language = languages.join(" & ");
  const country = normalizeKycCountry(context.country);
  const kycCountry = normalizeKycCountry(context.kycCountry || context.country);
  return {
    amount: parseKycAmount(value),
    language,
    languages,
    languageCategory: categorizeKycLanguages({
      country,
      kycCountry,
      languages,
    }),
  };
}

export { normalizeKycCountry, nativeLanguagesForCountry };
