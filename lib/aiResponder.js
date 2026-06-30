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

async function callN8nRelay(url, context, { fetchImpl, secret, timeoutMs }) {
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-ai-secret": secret } : {}),
      },
      body: JSON.stringify({ messages: context.messages, question: context.question || "" }),
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json().catch(() => ({}));
    const text = data?.text || data?.reply || data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
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
