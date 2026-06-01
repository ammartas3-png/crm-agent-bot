import assert from "node:assert/strict";
import test from "node:test";

import {
  accessApprovalKeyboard,
  approveAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  describeTelegramUser,
  getAccessRequest,
  registerAdminChat,
} from "../lib/accessRequests.js";
import { clearRuntimeApprovals, isAllowedTelegramUser } from "../lib/permissions.js";

test("createAccessRequest stores pending request", () => {
  const request = createAccessRequest({ id: 101, username: "newuser" }, 101, "hello");

  assert.equal(getAccessRequest(request.id).status, "pending");
  assert.equal(getAccessRequest(request.id).messageText, "hello");
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
