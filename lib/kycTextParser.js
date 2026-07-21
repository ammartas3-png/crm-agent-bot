import { normalizeText } from "./calculations.js";

const LANGUAGE_LABEL_PATTERN =
  /\b(?:language|lang|customer\s+language|spoken\s+language)\s*[:=-]\s*([^\n\r,;|]+)/i;
const AMOUNT_LABEL_PATTERN =
  /\b(?:approved\s+deposit|deposit\s+amount|amount|deposit|ftd)\s*[:=-]?\s*(?:usd|\$)?\s*([0-9][0-9\s.,]*)\b/i;
const CURRENCY_AMOUNT_PATTERN = /(?:usd|\$)\s*([0-9][0-9\s.,]*)\b/i;
const LANGUAGE_SPLIT_PATTERN = /\s*(?:&|\/|,|\band\b)\s*/i;

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
  ["spanish", "Spanish"],
  ["es", "Spanish"],
  ["espanol", "Spanish"],
  ["castellano", "Spanish"],
  ["hindi", "Hindi"],
  ["indian", "Hindi"],
  ["indonesian", "Indonesian"],
  ["bahasa", "Indonesian"],
  ["japanese", "Japanese"],
  ["jp", "Japanese"],
  ["malay", "Malay"],
  ["malaysia", "Malay"],
  ["bahasa malaysia", "Malay"],
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
  ["japan", ["Japanese"]],
  ["malaysia", ["Malay"]],
  ["chile", ["Spanish"]],
  ["argentina", ["Spanish"]],
  ["colombia", ["Spanish"]],
  ["peru", ["Spanish"]],
  ["mexico", ["Spanish"]],
  ["ecuador", ["Spanish"]],
  ["uruguay", ["Spanish"]],
  ["paraguay", ["Spanish"]],
  ["bolivia", ["Spanish"]],
  ["venezuela", ["Spanish"]],
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

function languageLabelValue(value = "") {
  const text = compactText(value);
  if (!text) {
    return "";
  }
  const labelMatch = text.match(LANGUAGE_LABEL_PATTERN);
  return labelMatch ? labelMatch[1] : text;
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

export function parseKycLanguageParts(value = "") {
  const raw = languageLabelValue(value);
  if (!raw) {
    return [];
  }
  const parts = raw
    .split(LANGUAGE_SPLIT_PATTERN)
    .map((part) => canonicalLanguage(part))
    .filter(Boolean);
  if (parts.length) {
    return [...new Set(parts)];
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

function isNativeLanguage(language = "", country = "") {
  const nativeLanguages = NATIVE_LANGUAGES_BY_COUNTRY.get(normalizeText(country)) || [];
  return nativeLanguages.some((item) => normalizeText(item) === normalizeText(language));
}

export function categorizeKycLanguages({ country = "", languages = [] } = {}) {
  const canonicalLanguages = (Array.isArray(languages) ? languages : [])
    .map((language) => canonicalLanguage(language))
    .filter(Boolean);
  if (!canonicalLanguages.length) {
    return "Other";
  }
  const hasEnglish = canonicalLanguages.some((language) => isEnglishLanguage(language));
  const hasNative = canonicalLanguages.some((language) => isNativeLanguage(language, country));
  if (hasEnglish && hasNative) {
    return "English & Native";
  }
  if (hasEnglish) {
    return "English";
  }
  if (hasNative) {
    return "Native";
  }
  if (canonicalLanguages.length === 1) {
    return "Other";
  }
  return "Other";
}

export function categorizeKycLanguage({ country = "", language = "" } = {}) {
  const languages = Array.isArray(language)
    ? language
    : parseKycLanguageParts(String(language || "").includes("Language:") ? language : `Language: ${language}`);
  return categorizeKycLanguages({ country, languages });
}

export function parseKycText(value = "", context = {}) {
  const languages = parseKycLanguageParts(value);
  const language = languages.join(" & ");
  return {
    amount: parseKycAmount(value),
    language,
    languages,
    languageCategory: categorizeKycLanguages({
      country: context.country,
      languages,
    }),
  };
}
