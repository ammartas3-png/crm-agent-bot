import assert from "node:assert/strict";
import test from "node:test";

import {
  accessApprovalKeyboard,
  adminChatIds,
  approveAccessRequest,
  clearRuntimeAdminChats,
  createAccessRequest,
  denyAccessRequest,
  describeTelegramUser,
  findPendingAccessRequestByUser,
  getAccessRequest,
  listPendingAccessRequests,
  notifyAdminsForAccessRequest,
  registerAdminChat,
} from "../lib/accessRequests.js";
import { clearRuntimeApprovals, isAllowedTelegramUser } from "../lib/permissions.js";

test("createAccessRequest stores pending request", () => {
  const request = createAccessRequest({ id: 101, username: "newuser" }, 101, "hello");

  assert.equal(getAccessRequest(request.id).status, "pending");
  assert.equal(getAccessRequest(request.id).messageText, "hello");
  assert.equal(listPendingAccessRequests().some((item) => item.id === request.id), true);
});

test("findPendingAccessRequestByUser returns pending request for same user", () => {
  const request = createAccessRequest({ id: 1111, username: "pending_lookup" }, 1111, "please approve");
  const pending = findPendingAccessRequestByUser({ id: 1111, username: "pending_lookup" });
  assert.equal(pending?.id, request.id);
});

test("accessApprovalKeyboard contains approve and deny callbacks", () => {
  const keyboard = accessApprovalKeyboard("abc");
  const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data);

  assert.deepEqual(callbacks, ["access:approve:abc", "access:deny:abc", "access:scope:abc"]);
});

test("approveAccessRequest grants runtime access", () => {
  clearRuntimeApprovals();
  const request = createAccessRequest({ id: 202, username: "approveduser" }, 202);

  assert.equal(isAllowedTelegramUser(request.user, new Set(), new Set()), false);
  const approved = approveAccessRequest(request.id);

  assert.equal(approved.status, "approved");
  assert.equal(isAllowedTelegramUser(request.user, new Set(), new Set()), true);
  clearRuntimeApprovals();
});

test("denyAccessRequest does not grant access", () => {
  clearRuntimeApprovals();
  const request = createAccessRequest({ id: 303, username: "denieduser" }, 303);
  const denied = denyAccessRequest(request.id);

  assert.equal(denied.status, "denied");
  assert.equal(isAllowedTelegramUser(request.user, new Set(), new Set()), false);
});

test("describeTelegramUser formats useful admin context", () => {
  const description = describeTelegramUser({
    id: 404,
    username: "someone",
    first_name: "Some",
    last_name: "One",
  });

  assert.match(description, /Some One/);
  assert.match(description, /@someone/);
  assert.match(description, /ID: 404/);
});

test("registerAdminChat ignores non-admin users", () => {
  assert.doesNotThrow(() => registerAdminChat({ id: 505, username: "regular" }, 505));
});

test("adminChatIds includes numeric admin user ids", () => {
  const previousAdminUsers = process.env.ADMIN_USERS;
  const previousAdminChatIds = process.env.ADMIN_CHAT_IDS;
  try {
    clearRuntimeAdminChats();
    process.env.ADMIN_USERS = "123456,@some-admin";
    process.env.ADMIN_CHAT_IDS = "";
    const ids = adminChatIds();
    assert.equal(ids.includes("123456"), true);
  } finally {
    process.env.ADMIN_USERS = previousAdminUsers;
    process.env.ADMIN_CHAT_IDS = previousAdminChatIds;
    clearRuntimeAdminChats();
  }
});

test("notifyAdminsForAccessRequest continues after one recipient fails", async () => {
  const previousAdminUsers = process.env.ADMIN_USERS;
  const previousAdminChatIds = process.env.ADMIN_CHAT_IDS;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalFetch = global.fetch;
  const sentTo = [];
  try {
    clearRuntimeAdminChats();
    process.env.ADMIN_USERS = "";
    process.env.ADMIN_CHAT_IDS = "111,222";
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    global.fetch = async (_url, options = {}) => {
      const payload = JSON.parse(String(options.body || "{}"));
      const chatId = String(payload.chat_id || "");
      if (chatId === "111") {
        return {
          ok: false,
          statusText: "Forbidden",
          json: async () => ({ ok: false, description: "Forbidden: bot was blocked by the user" }),
        };
      }
      sentTo.push(chatId);
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      };
    };
    const request = createAccessRequest({ id: 909, username: "pending-user" }, 909, "/start");
    const result = await notifyAdminsForAccessRequest(request);
    assert.equal(result.sent, sentTo.length);
    assert.equal(result.sent >= 1, true);
    assert.equal(Array.isArray(result.failed), true);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].chatId, "111");
    assert.equal(sentTo.includes("222"), true);
  } finally {
    process.env.ADMIN_USERS = previousAdminUsers;
    process.env.ADMIN_CHAT_IDS = previousAdminChatIds;
    process.env.TELEGRAM_BOT_TOKEN = previousToken;
    global.fetch = originalFetch;
    clearRuntimeAdminChats();
  }
});
