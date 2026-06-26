import {
  approveTelegramUser,
  denyTelegramUser,
  isAdminTelegramUser,
  parseAdminChatIds,
} from "./permissions.js";
import { storeGet, storeSet, storeSetAdd, storeSetMembers } from "./store.js";
import { sendTelegramMessage } from "./telegram.js";

const ADMIN_CHATS_KEY = "crm:admin_chats";
const ACCESS_REQUEST_PREFIX = "crm:access_request:";
const ACCESS_REQUEST_TTL_SECONDS = 60 * 60 * 24;

const pendingRequests = new Map();
const runtimeAdminChatIds = new Set();

function persistAccessRequest(request) {
  storeSet(
    `${ACCESS_REQUEST_PREFIX}${request.id}`,
    JSON.stringify(request),
    ACCESS_REQUEST_TTL_SECONDS,
  );
}

function requestId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function registerAdminChat(telegramUser, chatId) {
  if (isAdminTelegramUser(telegramUser) && chatId !== undefined && chatId !== null) {
    runtimeAdminChatIds.add(String(chatId));
    storeSetAdd(ADMIN_CHATS_KEY, String(chatId));
  }
}

export function adminChatIds() {
  return [...new Set([...parseAdminChatIds(), ...runtimeAdminChatIds])];
}

// Re-populates remembered admin chat IDs from the persistent store.
export async function hydrateAdminChats() {
  const members = await storeSetMembers(ADMIN_CHATS_KEY);
  for (const chatId of members) {
    if (chatId) {
      runtimeAdminChatIds.add(String(chatId));
    }
  }
}

export function describeTelegramUser(user = {}) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : "";
  const id = user.id ? `ID: ${user.id}` : "";
  return [name, username, id].filter(Boolean).join("\n") || "Unknown user";
}

export function createAccessRequest(user, chatId, messageText = "") {
  const id = requestId();
  const request = {
    id,
    user,
    chatId,
    messageText,
    status: "pending",
    createdAt: Date.now(),
  };
  pendingRequests.set(id, request);
  persistAccessRequest(request);
  return request;
}

export function getAccessRequest(id) {
  return pendingRequests.get(id) || null;
}

// Loads a persisted access request into memory after a cold start so an
// admin's Approve/Deny tap still resolves on a fresh serverless instance.
export async function hydrateAccessRequest(id) {
  if (!id) {
    return null;
  }
  if (pendingRequests.has(id)) {
    return pendingRequests.get(id);
  }
  const raw = await storeGet(`${ACCESS_REQUEST_PREFIX}${id}`);
  if (!raw) {
    return null;
  }
  try {
    const request = JSON.parse(raw);
    pendingRequests.set(id, request);
    return request;
  } catch {
    return null;
  }
}

export function accessApprovalKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `access:approve:${id}` },
        { text: "Deny", callback_data: `access:deny:${id}` },
      ],
    ],
  };
}

export function accessRequestMessage(request) {
  return [
    "Access approval request",
    "",
    describeTelegramUser(request.user),
    request.messageText ? `Message: ${request.messageText}` : "",
    "",
    "Approve this user?",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function notifyAdminsForAccessRequest(request) {
  const recipients = adminChatIds();
  if (recipients.length === 0) {
    return { sent: 0, reason: "no_admin_chat_ids" };
  }

  let sent = 0;
  for (const chatId of recipients) {
    await sendTelegramMessage(chatId, accessRequestMessage(request), {
      replyMarkup: accessApprovalKeyboard(request.id),
    });
    sent += 1;
  }
  return { sent };
}

export function approveAccessRequest(id) {
  const request = getAccessRequest(id);
  if (!request || request.status !== "pending") {
    return null;
  }
  request.status = "approved";
  request.decidedAt = Date.now();
  approveTelegramUser(request.user);
  persistAccessRequest(request);
  return request;
}

export function denyAccessRequest(id) {
  const request = getAccessRequest(id);
  if (!request || request.status !== "pending") {
    return null;
  }
  request.status = "denied";
  request.decidedAt = Date.now();
  denyTelegramUser(request.user);
  persistAccessRequest(request);
  return request;
}
