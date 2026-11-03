import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeApprover,
  isAuthorizedApprover,
  parseApproverIds,
} from "../lib/approvers.ts";
import type { MembershipLookup } from "../lib/approvers.ts";

const neverCalled: MembershipLookup = async () => {
  throw new Error("The channel membership lookup must not run");
};

test("authorizes an ID that is in the configured list", () => {
  const allowedIds = parseApproverIds("U123,U456");

  assert.deepEqual(allowedIds, ["U123", "U456"]);
  assert.equal(isAuthorizedApprover("U123", allowedIds), true);
});

test("refuses an ID outside the configured list", () => {
  assert.equal(
    isAuthorizedApprover("U999", parseApproverIds("U123,U456")),
    false
  );
});

test("refuses everyone when the list is empty", () => {
  assert.equal(isAuthorizedApprover("U123", []), false);
});

test("refuses everyone when the variable is missing", () => {
  const allowedIds = parseApproverIds(undefined);

  assert.deepEqual(allowedIds, []);
  assert.equal(isAuthorizedApprover("U123", allowedIds), false);
});

test("authorizes an allowlisted user without checking channel membership", async () => {
  const decision = await authorizeApprover({
    userId: "U123",
    allowedIds: parseApproverIds("U123,U456"),
    channelId: "C123",
    isChannelMember: neverCalled,
  });

  assert.deepEqual(decision, { authorized: true });
});

test("authorizes a member of the approvals channel", async () => {
  const decision = await authorizeApprover({
    userId: "U789",
    allowedIds: [],
    channelId: "C123",
    isChannelMember: async (userId, channelId) => {
      assert.equal(userId, "U789");
      assert.equal(channelId, "C123");
      return true;
    },
  });

  assert.deepEqual(decision, { authorized: true });
});

test("refuses a user who is not a member of the approvals channel", async () => {
  const decision = await authorizeApprover({
    userId: "U789",
    allowedIds: [],
    channelId: "C123",
    isChannelMember: async () => false,
  });

  assert.deepEqual(decision, {
    authorized: false,
    reason: "not-a-member",
  });
});

test("refuses when the Slack membership lookup fails", async () => {
  const decision = await authorizeApprover({
    userId: "U789",
    allowedIds: [],
    channelId: "C123",
    isChannelMember: async () => {
      throw new Error("Slack is unreachable or timed out");
    },
  });

  assert.deepEqual(decision, {
    authorized: false,
    reason: "channel-check-failed",
  });
});

test("refuses when the approvals channel ID is missing", async () => {
  const decision = await authorizeApprover({
    userId: "U789",
    allowedIds: [],
    channelId: undefined,
    isChannelMember: neverCalled,
  });

  assert.deepEqual(decision, {
    authorized: false,
    reason: "no-approvals-channel",
  });
});

test("refuses a click without a user ID", async () => {
  const decision = await authorizeApprover({
    userId: undefined,
    allowedIds: [],
    channelId: "C123",
    isChannelMember: neverCalled,
  });

  assert.deepEqual(decision, {
    authorized: false,
    reason: "unknown-user",
  });
});
