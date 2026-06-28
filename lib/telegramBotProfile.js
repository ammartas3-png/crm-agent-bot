import { hasTelegramBotToken } from "./telegram.js";

const BOT_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
let botProfileCache = null;
let botProfileInflight = null;

async function fetchBotProfile() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    return null;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false || !payload?.result) {
    return null;
  }
  return payload.result;
}

export async function getTelegramBotProfile() {
  if (!hasTelegramBotToken()) {
    return null;
  }
  if (botProfileCache && Date.now() - botProfileCache.ts < BOT_PROFILE_CACHE_TTL_MS) {
    return botProfileCache.value;
  }
  if (botProfileInflight) {
    return botProfileInflight;
  }
  botProfileInflight = fetchBotProfile()
    .then((value) => {
      botProfileCache = { ts: Date.now(), value };
      return value;
    })
    .finally(() => {
      botProfileInflight = null;
    });
  return botProfileInflight;
}

export async function getTelegramBotUsername() {
  const profile = await getTelegramBotProfile();
  return String(profile?.username || "").trim();
}
