import { NextResponse } from "next/server";

import { getTabConfig } from "../../../config/sheetsConfig.js";
import { loadLeadRows } from "../../../lib/dataProvider.js";
import { isAdminTelegramUser } from "../../../lib/permissions.js";
import { buildAnswerContext, detectLanguage, refusalMessage } from "../../../lib/aiAgent.js";

export const runtime = "nodejs";

// The AI endpoint reuses INGEST_SECRET by default so it works with the same
// credential the n8n workflows already hold; set AI_AGENT_SECRET to use a
// dedicated one.
function agentSecret(env = process.env) {
  return String(env.AI_AGENT_SECRET || env.INGEST_SECRET || "").trim();
}

function providedSecret(request, url) {
  const header = request.headers.get("x-ai-secret") || request.headers.get("x-ingest-secret");
  if (header) {
    return header;
  }
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return url.searchParams.get("secret") || "";
}

async function readBody(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

async function handle(request, { question, telegramUserId, telegramUser }) {
  const url = new URL(request.url);
  const secret = agentSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set AI_AGENT_SECRET (or INGEST_SECRET) to use the AI endpoint." },
      { status: 503 },
    );
  }
  if (providedSecret(request, url) !== secret) {
    return NextResponse.json({ ok: false, error: "Invalid secret" }, { status: 401 });
  }

  // Admin-only: when the caller forwards the Telegram identity, it must be an
  // admin. (The secret itself is admin-grade, so this is defense in depth and
  // lets n8n enforce per-user gating.)
  const principal = telegramUser || telegramUserId;
  if (principal !== undefined && principal !== null && String(principal).trim() !== "") {
    if (!isAdminTelegramUser(principal)) {
      const language = detectLanguage(question);
      return NextResponse.json(
        { ok: true, outOfScope: true, forbidden: true, language, refusal: refusalMessage(language) },
        { status: 200 },
      );
    }
  }

  if (!String(question || "").trim()) {
    return NextResponse.json({ ok: false, error: "Missing 'question'." }, { status: 400 });
  }

  try {
    const tabConfig = getTabConfig("leads");
    const rows = await loadLeadRows("leads", { tabConfig });
    const context = buildAnswerContext({ question, rows, tabConfig, now: new Date() });
    return NextResponse.json(context);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to build AI context." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const body = await readBody(request);
  const url = new URL(request.url);
  const question = body.question ?? body.text ?? url.searchParams.get("q") ?? "";
  const telegramUserId = body.telegramUserId ?? body.userId ?? body.from?.id ?? null;
  const telegramUser = body.telegramUser ?? body.from ?? null;
  return handle(request, { question, telegramUserId, telegramUser });
}

export async function GET(request) {
  const url = new URL(request.url);
  const question = url.searchParams.get("q") || "";
  const telegramUserId = url.searchParams.get("userId") || null;
  return handle(request, { question, telegramUserId, telegramUser: null });
}
