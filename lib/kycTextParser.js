import { normalizeText } from "./calculations.js";

const LANGUAGE_LABEL_PATTERN =
  /\b(?:language|lang|customer\s+language|spoken\s+language)\s*[:=-]\s*([^\n\r,;|]+)/i;
const AMOUNT_LABEL_PATTERN =
  /\b(?:approved\s+deposit|deposit\s+amount|amount|deposit|ftd)\s*[:=-]?\s*(?:usd|\$)?\s*([0-9][0-9\s.,]*)\b/i;
const CURRENCY_AMOUNT_PATTERN = /(?:usd|\$)\s*([0-9][0-9\s.,]*)\b/i;

const LANGUAGE_ALIASES = new Map([
  ["arab", "Arabic"],
  ["arabic", "Arabic"],
  ["bangla", "Bengali"],
  ["bengali", "Bengali"],
  ["bengal", "Bengali"],
  ["english", "English"],
  ["eng", "English"],
  ["en", "English"],
  ["filipino", "Filipino"],
  ["tagalog", "Filipino"],
  ["french", "French"],
  ["fr", "French"],
  ["hindi", "Hindi"],
  ["indian", "Hindi"],
  ["indonesian", "Indonesian"],
  ["bahasa", "Indonesian"],
  ["thai", "Thai"],
  ["thailand", "Thai"],
  ["turkish", "Turkish"],
  ["turkce", "Turkish"],
  ["turkey", "Turkish"],
  ["urdu", "Urdu"],
  ["vietnamese", "Vietnamese"],
  ["viet", "Vietnamese"],
]);

const NATIVE_LANGUAGES_BY_COUNTRY = new Map([
  ["bangladesh", ["Bengali"]],
  ["india", ["Hindi", "Urdu"]],
  ["indonesia", ["Indonesian"]],
  ["philippines", ["Filipino"]],
  ["thailand", ["Thai"]],
  ["vietnam", ["Vietnamese"]],
  ["turkey", ["Turkish"]],
  ["turkiye", ["Turkish"]],
  ["new caledonia", ["French"]],
  ["french polynesia", ["French"]],
]);

function compactText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function canonicalLanguage(value = "") {
  const normalized = normalizeText(value)
    .replace(/[^a-z\s-]+/g, " ")
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
  const text = compactText(value);
  if (!text) {
    return "";
  }
  const labelMatch = text.match(LANGUAGE_LABEL_PATTERN);
  if (labelMatch) {
    return canonicalLanguage(labelMatch[1]);
  }
  return canonicalLanguage(text);
}

export function categorizeKycLanguage({ country = "", language = "" } = {}) {
  const canonical = canonicalLanguage(language);
  if (!canonical) {
    return "Other";
  }
  if (normalizeText(canonical) === "english") {
    return "English";
  }
  const nativeLanguages = NATIVE_LANGUAGES_BY_COUNTRY.get(normalizeText(country)) || [];
  const normalizedLanguage = normalizeText(canonical);
  return nativeLanguages.some((item) => normalizeText(item) === normalizedLanguage) ? "Native" : "Other";
}

export function parseKycText(value = "", context = {}) {
  const language = parseKycLanguage(value);
  return {
    amount: parseKycAmount(value),
    language,
    languageCategory: categorizeKycLanguage({
      country: context.country,
      language,
    }),
  };
}

