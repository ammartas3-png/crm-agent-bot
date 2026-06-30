// Admin-only AI reporting agent context builder.
//
// Design goals:
//   - Token efficiency: the LLM never sees raw rows. This module resolves the
//     question to an entity (agent / team leader / desk / country / campaign /
//     brand / placement) or an overview, then returns a small, rounded JSON of
//     facts plus a deterministic `draftAnswer`. n8n forwards only that compact
//     payload to OpenAI, which just phrases it. Out-of-scope questions are
//     flagged so n8n can answer with a canned refusal and skip OpenAI entirely.
//   - Scope guardrail: only CRM report questions are answered; anything else
//     gets a polite refusal in the user's language.
//   - Reuses the same calculations the dashboard/bot use, so the numbers match.

import {
  calculateSummary,
  filteredRows,
  getFieldName,
  getRowValue,
  statusDistribution,
  uniqueValues,
} from "./calculations.js";
import { extractDateFilter } from "./queryRouter.js";

const ENTITY_FIELDS = [
  { type: "agent", fieldKey: "agentNames" },
  { type: "teamLeader", fieldKey: "teamLeader" },
  { type: "desk", fieldKey: "office" },
  { type: "country", fieldKey: "country" },
  { type: "campaign", fieldKey: "campaign" },
  { type: "brand", fieldKey: "brand" },
  { type: "placement", fieldKey: "placement" },
];

// Priority when several entities are mentioned: the most specific wins.
const ENTITY_PRIORITY = ["agent", "teamLeader", "desk", "country", "campaign", "brand", "placement"];

// Reporting vocabulary (English + Turkish + a few others) used to decide whether
// a free-text question is about the CRM reports at all.
const REPORT_KEYWORDS = [
  "ftd", "ftds", "lead", "leads", "cr", "conversion", "convert", "deposit", "withdrawal",
  "call", "calls", "status", "no answer", "call again", "callback", "performance", "perform",
  "target", "reach", "desk", "team", "leader", "agent", "agents", "country", "countries",
  "campaign", "campaigns", "placement", "brand", "selfs", "late ftd", "report", "stats", "kpi",
  "best", "worst", "top", "compare", "comparison", "trend", "month", "today", "yesterday", "week",
  // Turkish
  "lider", "takım", "takim", "ajan", "ülke", "ulke", "kampanya", "masa", "hedef", "dönüşüm",
  "donusum", "arama", "çağrı", "cagri", "mevduat", "performans", "rapor", "en iyi", "en kötü",
  "en kotu", "kaç", "kac", "hangi", "nasıl", "nasil", "durum", "cevapsız", "cevapsiz",
];

const NO_ANSWER_PATTERNS = [
  "no answer", "noanswer", "not answered", "no reply", "unreachable",
  "cevapsız", "cevapsiz", "cevap yok", "ulaşılamadı", "ulasilamadi",
];
const CALL_AGAIN_PATTERNS = [
  "call again", "callagain", "call back", "callback", "recall", "call later",
  "tekrar ara", "tekrar aranacak", "geri ara", "sonra ara",
];

const REFUSALS = {
  tr: "Yalnızca CRM rapor sonuçlarıyla (ajan, takım lideri, masa, ülke, kampanya, FTD, lead, CR, durum vb.) ilgili soruları yanıtlayabilirim. Bunun dışındaki konularda yardımcı olamıyorum.",
  en: "I can only answer questions about the CRM report results (agents, team leaders, desks, countries, campaigns, FTD, leads, CR, statuses, etc.). I can't help with anything outside of that.",
  ar: "أستطيع فقط الإجابة عن الأسئلة المتعلقة بنتائج تقارير الـCRM (الوكلاء، قادة الفرق، المكاتب، الدول، الحملات، FTD، العملاء المحتملين، CR، الحالات). لا يمكنني المساعدة في أمور أخرى.",
  ru: "Я могу отвечать только на вопросы по результатам CRM-отчётов (агенты, тимлиды, отделы, страны, кампании, FTD, лиды, CR, статусы). По другим темам помочь не могу.",
  de: "Ich kann nur Fragen zu den CRM-Berichtsergebnissen beantworten (Agenten, Teamleiter, Desks, Länder, Kampagnen, FTD, Leads, CR, Status). Bei anderen Themen kann ich nicht helfen.",
  es: "Solo puedo responder preguntas sobre los resultados de los informes CRM (agentes, líderes de equipo, mesas, países, campañas, FTD, leads, CR, estados). No puedo ayudar con otros temas.",
};

function normalize(text) {
  return String(text || "").trim().toLocaleLowerCase("en-US");
}

function round(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

export function detectLanguage(text = "") {
  const raw = String(text || "");
  if (/[\u0600-\u06FF]/.test(raw)) {
    return "ar";
  }
  if (/[\u0400-\u04FF]/.test(raw)) {
    return "ru";
  }
  const lower = raw.toLocaleLowerCase("tr-TR");
  if (/[çğışöü]/.test(lower) || /\b(nasıl|kaç|hangi|ülke|takım|ajan|kampanya|masa|en iyi|en kötü|lider|durum|rapor)\b/.test(lower)) {
    return "tr";
  }
  if (/\b(cómo|cuántos|cuál|país|equipo|agente|campaña|mejor|peor)\b/.test(lower)) {
    return "es";
  }
  if (/\b(wie viele|welche|länder|kampagne|beste|schlechteste|leiter)\b/.test(lower)) {
    return "de";
  }
  return "en";
}

export function refusalMessage(language = "en") {
  return REFUSALS[language] || REFUSALS.en;
}

function mentionsReportKeyword(question) {
  const normalized = normalize(question);
  return REPORT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

// Finds the most specific entity (and its field) mentioned in the question by
// matching against the actual values present in the data.
export function resolveEntity(question, rows, tabConfig) {
  const normalized = normalize(question);
  const matches = [];
  for (const { type, fieldKey } of ENTITY_FIELDS) {
    const values = uniqueValues(rows, tabConfig, fieldKey, 2000);
    let best = null;
    for (const value of values) {
      const normalizedValue = normalize(value);
      if (normalizedValue.length < 2) {
        continue;
      }
      // Word-ish boundary match to avoid matching "it" inside "italy".
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u");
      if (pattern.test(normalized) && (!best || normalizedValue.length > normalize(best).length)) {
        best = value;
      }
    }
    if (best) {
      matches.push({ type, fieldKey, value: best });
    }
  }
  if (!matches.length) {
    return null;
  }
  matches.sort(
    (left, right) =>
      ENTITY_PRIORITY.indexOf(left.type) - ENTITY_PRIORITY.indexOf(right.type) ||
      normalize(right.value).length - normalize(left.value).length,
  );
  return matches[0];
}

function entityFilters(entity) {
  if (!entity) {
    return {};
  }
  switch (entity.type) {
    case "agent":
      return { agent: [entity.value], agentField: "agentNames" };
    case "teamLeader":
      return { teamLeader: [entity.value] };
    case "desk":
      return { desk: [entity.value] };
    case "country":
      return { country: [entity.value] };
    case "campaign":
      return { campaign: [entity.value] };
    case "brand":
      return { brand: [entity.value] };
    case "placement":
      return { placement: [entity.value] };
    default:
      return {};
  }
}

function compactSummary(summary) {
  return {
    leads: Number(summary.totalLeads || 0),
    ftd: Number(summary.totalFtd || 0),
    cr: round(summary.cr),
    crTarget: round(summary.crTarget),
    crTargetReach: round(summary.crTargetReach),
    lateFtd: Number(summary.lateFtd || 0),
    selfs: Number(summary.selfs || 0),
  };
}

// Groups entity rows by a field and returns the top buckets (by lead volume)
// with leads/ftd/cr/reach. Computes the heavy summary only for the top buckets.
function breakdownByField(entityRows, tabConfig, fieldKey, now, limit = 6) {
  const fieldName = getFieldName(tabConfig, fieldKey);
  const groups = new Map();
  for (const row of entityRows) {
    const label = String(getRowValue(row, fieldName) || "").trim();
    if (!label) {
      continue;
    }
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(row);
  }
  const topGroups = [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, limit);
  return topGroups
    .map(([label, groupRows]) => {
      const summary = calculateSummary(groupRows, tabConfig, {}, now);
      return {
        label,
        leads: Number(summary.totalLeads || 0),
        ftd: Number(summary.totalFtd || 0),
        cr: round(summary.cr),
        crTargetReach: round(summary.crTargetReach),
      };
    })
    .sort((left, right) => right.leads - left.leads);
}

function shareForPatterns(statusList, patterns) {
  return round(
    statusList
      .filter((item) => patterns.some((pattern) => normalize(item.label).includes(pattern)))
      .reduce((sum, item) => sum + Number(item.percentage || 0), 0),
  );
}

function topStatuses(statusList, limit = 5) {
  return statusList.slice(0, limit).map((item) => ({
    status: item.label,
    count: Number(item.value || 0),
    share: round(item.percentage),
  }));
}

// Picks the strongest / weakest buckets by target reach among those with enough
// volume, so insights like "good in X, weak in Y" are grounded, not noise.
function strengthsAndWeaknesses(breakdown, minLeads = 5) {
  const eligible = breakdown.filter((item) => item.leads >= minLeads);
  if (eligible.length < 2) {
    return { strong: eligible.slice(0, 1), weak: [] };
  }
  const byReach = [...eligible].sort((left, right) => right.crTargetReach - left.crTargetReach);
  return {
    strong: byReach.slice(0, 2),
    weak: byReach.slice(-2).reverse(),
  };
}

const DIMENSION_LABELS = {
  agent: { tr: "ajan", en: "agent" },
  teamLeader: { tr: "takım lideri", en: "team leader" },
  desk: { tr: "masa", en: "desk" },
  country: { tr: "ülke", en: "country" },
  campaign: { tr: "kampanya", en: "campaign" },
  brand: { tr: "marka", en: "brand" },
  placement: { tr: "placement", en: "placement" },
};

function buildFacts({ entity, entityRows, tabConfig, now }) {
  const summary = calculateSummary(entityRows, tabConfig, {}, now);
  const statusList = statusDistribution(entityRows, tabConfig, {}, now);
  const facts = {
    entityType: entity.type,
    entity: entity.value,
    totals: compactSummary(summary),
    statuses: topStatuses(statusList),
    noAnswerShare: shareForPatterns(statusList, NO_ANSWER_PATTERNS),
    callAgainShare: shareForPatterns(statusList, CALL_AGAIN_PATTERNS),
  };

  // Entity-specific breakdowns that map to the kinds of questions admins ask.
  if (entity.type === "agent") {
    facts.byCountry = breakdownByField(entityRows, tabConfig, "country", now);
    facts.byCampaign = breakdownByField(entityRows, tabConfig, "campaign", now);
    const sw = strengthsAndWeaknesses(facts.byCountry.length >= 2 ? facts.byCountry : facts.byCampaign);
    facts.strong = sw.strong;
    facts.weak = sw.weak;
  } else if (entity.type === "teamLeader") {
    facts.agents = breakdownByField(entityRows, tabConfig, "agentNames", now, 12);
    facts.byCountry = breakdownByField(entityRows, tabConfig, "country", now);
    const sw = strengthsAndWeaknesses(facts.agents);
    facts.bestAgents = sw.strong;
    facts.weakAgents = sw.weak;
  } else if (entity.type === "desk") {
    facts.teamLeaders = breakdownByField(entityRows, tabConfig, "teamLeader", now, 10);
    facts.byCountry = breakdownByField(entityRows, tabConfig, "country", now);
    facts.byCampaign = breakdownByField(entityRows, tabConfig, "campaign", now);
  } else if (entity.type === "country") {
    facts.byDesk = breakdownByField(entityRows, tabConfig, "office", now);
    facts.byCampaign = breakdownByField(entityRows, tabConfig, "campaign", now);
    facts.topAgents = breakdownByField(entityRows, tabConfig, "agentNames", now);
  } else {
    // campaign / brand / placement
    facts.byCountry = breakdownByField(entityRows, tabConfig, "country", now);
    facts.byDesk = breakdownByField(entityRows, tabConfig, "office", now);
    facts.topAgents = breakdownByField(entityRows, tabConfig, "agentNames", now);
  }
  return facts;
}

function buildOverviewFacts({ rows, tabConfig, dateFilter, now }) {
  const scopedRows = filteredRows(rows, tabConfig, dateFilter ? { date: dateFilter } : {}, now);
  const summary = calculateSummary(rows, tabConfig, dateFilter ? { date: dateFilter } : {}, now);
  return {
    entityType: "overview",
    totals: compactSummary(summary),
    topDesks: breakdownByField(scopedRows, tabConfig, "office", now),
    topCountries: breakdownByField(scopedRows, tabConfig, "country", now),
    topCampaigns: breakdownByField(scopedRows, tabConfig, "campaign", now),
  };
}

function pct(value) {
  return `${round(value)}%`;
}

function describeBreakdown(items = []) {
  return items
    .map((item) => `${item.label} (${item.leads} leads, ${item.ftd} FTD, CR ${pct(item.cr)})`)
    .join("; ");
}

// Deterministic, dependency-free summary. Doubles as a fallback when OpenAI is
// unavailable and as low-token "ground truth" the model only needs to rephrase.
function buildDraftAnswer(facts, language = "en") {
  if (facts.entityType === "overview") {
    return [
      `Overall: ${facts.totals.leads} leads, ${facts.totals.ftd} FTD (CR ${pct(facts.totals.cr)}, target reach ${pct(facts.totals.crTargetReach)}).`,
      facts.topDesks.length ? `Top desks: ${describeBreakdown(facts.topDesks.slice(0, 3))}.` : "",
      facts.topCountries.length ? `Top countries: ${describeBreakdown(facts.topCountries.slice(0, 3))}.` : "",
    ].filter(Boolean).join(" ");
  }
  const label = DIMENSION_LABELS[facts.entityType]?.[language] || facts.entityType;
  const lines = [
    `${facts.entity} (${label}): ${facts.totals.leads} leads, ${facts.totals.ftd} FTD, CR ${pct(facts.totals.cr)}, target reach ${pct(facts.totals.crTargetReach)}.`,
  ];
  if (facts.strong?.length) {
    lines.push(`Strong: ${describeBreakdown(facts.strong)}.`);
  }
  if (facts.weak?.length) {
    lines.push(`Weak: ${describeBreakdown(facts.weak)}.`);
  }
  if (facts.bestAgents?.length) {
    lines.push(`Best agents: ${describeBreakdown(facts.bestAgents)}.`);
  }
  if (facts.weakAgents?.length) {
    lines.push(`Weak agents: ${describeBreakdown(facts.weakAgents)}.`);
  }
  if (facts.teamLeaders?.length) {
    lines.push(`Team leaders: ${describeBreakdown(facts.teamLeaders.slice(0, 4))}.`);
  }
  if (facts.topAgents?.length && !facts.bestAgents) {
    lines.push(`Top agents: ${describeBreakdown(facts.topAgents.slice(0, 4))}.`);
  }
  if (Number(facts.noAnswerShare) > 0 || Number(facts.callAgainShare) > 0) {
    lines.push(`Status issues: no-answer ${pct(facts.noAnswerShare)}, call-again ${pct(facts.callAgainShare)}.`);
  }
  return lines.join(" ");
}

function buildSystemPrompt(language) {
  return [
    "You are a CRM reporting analyst assisting an admin.",
    "Answer ONLY using the JSON facts provided (leads, FTD, CR, target reach, status shares, per-country/campaign/agent breakdowns).",
    "Be concise and specific: call out where the entity is strong vs weak, and flag status problems such as high no-answer or high call-again with low FTD.",
    `Reply in this language code: ${language}.`,
    "Never invent numbers or entities. If the facts are empty, say there is no data for that scope.",
    "Do not answer anything unrelated to these CRM reports.",
  ].join(" ");
}

function suggestionList(language) {
  const tr = [
    "X masasında hangi takımlar çalışıyor ve performansları nasıl?",
    "Lider Y'nin ajanları nasıl, en zayıf ajan kim?",
    "Ajan Z hangi ülke/kampanyada iyi, nerede kötü?",
    "Almanya'da en iyi masa ve kampanya hangisi?",
    "Hangi ajanların no-answer oranı yüksek ama FTD'si düşük?",
    "Bu ay en iyi 5 ajan FTD'ye göre?",
  ];
  const en = [
    "Which teams work in desk X and how do they perform?",
    "How are leader Y's agents doing, who is weakest?",
    "Where is agent Z strong vs weak by country/campaign?",
    "Best desk and campaign in Germany?",
    "Which agents have high no-answer but low FTD?",
    "Top 5 agents by FTD this month?",
  ];
  return language === "tr" ? tr : en;
}

// Main entry point. Returns a compact, token-efficient context for the AI layer.
export function buildAnswerContext({ question, rows = [], tabConfig, now = new Date(), scopeFilters = {} }) {
  const language = detectLanguage(question);
  const trimmed = String(question || "").trim();

  if (!trimmed) {
    return { ok: true, outOfScope: true, language, refusal: refusalMessage(language) };
  }

  const entity = resolveEntity(question, rows, tabConfig);
  const inScope = Boolean(entity) || mentionsReportKeyword(question);
  if (!inScope) {
    return { ok: true, outOfScope: true, language, refusal: refusalMessage(language), suggestions: suggestionList(language) };
  }

  const dateFilter = extractDateFilter(question, now);
  const systemPrompt = buildSystemPrompt(language);

  let facts;
  if (entity) {
    const entityRows = filteredRows(
      rows,
      tabConfig,
      { ...entityFilters(entity), ...(dateFilter ? { date: dateFilter } : {}), ...scopeFilters },
      now,
    );
    if (!entityRows.length) {
      facts = { entityType: entity.type, entity: entity.value, totals: compactSummary({}), statuses: [], empty: true };
    } else {
      facts = buildFacts({ entity, entityRows, tabConfig, now });
    }
  } else {
    facts = buildOverviewFacts({ rows, tabConfig, dateFilter, now });
  }

  const draftAnswer = buildDraftAnswer(facts, language);
  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${trimmed}\n\nFACTS (JSON, the only source of truth):\n${JSON.stringify(facts)}`,
    },
  ];

  return {
    ok: true,
    outOfScope: false,
    language,
    question: trimmed,
    intent: entity ? { entityType: entity.type, value: entity.value } : { entityType: "overview" },
    dateScoped: Boolean(dateFilter),
    facts,
    draftAnswer,
    systemPrompt,
    messages,
    suggestions: suggestionList(language),
  };
}
