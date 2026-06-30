// Turns an aiAgent context into a final reply string for the (single) Telegram
// bot. The heavy retrieval/aggregation already happened in lib/aiAgent.js; here
// we only let the LLM rephrase the compact facts. Resolution order:
//   1. out-of-scope            -> canned refusal (no LLM call)
//   2. AI_N8N_WEBHOOK_URL set  -> POST {messages} to an n8n Webhook that runs
//                                 OpenAI and responds { text } (keeps the key in n8n)
//   3. OPENAI_API_KEY set      -> call OpenAI chat completions directly
//   4. otherwise / on error    -> deterministic draftAnswer (always answers)

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_TOKENS = 220;

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// The grounded user prompt (question + compact FACTS json) the agent should
// answer from. We send it under several common field names so it works with any
// existing n8n AI workflow (AI Agent node reads `chatInput`; HTTP/code nodes may
// read `message`, `input`, `text`, `prompt`, or the raw `messages` array).
function relayPayload(context) {
  const userMessage =
    (Array.isArray(context.messages)
      ? context.messages.find((message) => message?.role === "user")?.content
      : "") ||
    context.question ||
    "";
  const systemMessage = Array.isArray(context.messages)
    ? context.messages.find((message) => message?.role === "system")?.content || ""
    : context.systemPrompt || "";
  return {
    question: context.question || "",
    chatInput: userMessage,
    message: userMessage,
    input: userMessage,
    text: userMessage,
    prompt: userMessage,
    system: systemMessage,
    language: context.language || "",
    facts: context.facts || null,
    draftAnswer: context.draftAnswer || "",
    messages: context.messages || [],
  };
}

// Accepts whatever shape the n8n workflow returns. n8n often wraps output in an
// array ([{ json: {...} }] or [{...}]) and AI Agent nodes emit `output`.
function extractRelayText(data) {
  let payload = data;
  if (Array.isArray(payload)) {
    payload = payload[0];
  }
  if (payload && typeof payload === "object" && payload.json && typeof payload.json === "object") {
    payload = payload.json;
  }
  if (typeof payload === "string") {
    return payload.trim() || null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate =
    payload.text ||
    payload.reply ||
    payload.output ||
    payload.answer ||
    payload.content ||
    payload.message ||
    payload.result ||
    payload.response ||
    payload?.data?.text ||
    payload?.choices?.[0]?.message?.content;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

async function callN8nRelay(url, context, { fetchImpl, secret, timeoutMs }) {
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-ai-secret": secret } : {}),
      },
      body: JSON.stringify(relayPayload(context)),
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => null);
    return extractRelayText(data);
  } catch {
    return null;
  } finally {
    clear();
  }
}

async function callOpenAi(context, { fetchImpl, env, timeoutMs }) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return null;
  }
  const baseUrl = String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = String(env.OPENAI_MODEL || DEFAULT_MODEL).trim();
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: context.messages,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: 0.2,
      }),
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => ({}));
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clear();
  }
}

export async function generateAiReply(context, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || env.AI_REPLY_TIMEOUT_MS || 30000);

  if (!context || context.ok === false) {
    return "Sorry, I could not build an answer right now.";
  }
  if (context.outOfScope) {
    return context.refusal || "I can only answer CRM reporting questions.";
  }

  const relayUrl = String(env.AI_N8N_WEBHOOK_URL || "").trim();
  if (relayUrl && fetchImpl) {
    const relayText = await callN8nRelay(relayUrl, context, {
      fetchImpl,
      secret: String(env.AI_AGENT_SECRET || env.INGEST_SECRET || "").trim(),
      timeoutMs,
    });
    if (relayText) {
      return relayText;
    }
  }

  if (fetchImpl) {
    const openAiText = await callOpenAi(context, { fetchImpl, env, timeoutMs });
    if (openAiText) {
      return openAiText;
    }
  }

  // No LLM configured or the call failed: still answer with the deterministic
  // summary the app computed.
  return context.draftAnswer || "No data found for that scope.";
}

export function aiConfigured(env = process.env) {
  return Boolean(
    String(env.AI_N8N_WEBHOOK_URL || "").trim() || String(env.OPENAI_API_KEY || "").trim(),
  );
}
