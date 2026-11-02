import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInactiveBlocks,
  type IncomingSlackBlock,
} from "../lib/slack-blocks.ts";

const approvedSection: IncomingSlackBlock = {
  type: "section",
  text: {
    type: "mrkdwn",
    text: "*Approved by @ana (U123) · 2026-10-30T12:00:00Z*",
  },
};

test("keeps the recorded decision and removes only the action buttons", () => {
  const blocks: IncomingSlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Approval decision" },
    },
    approvedSection,
    {
      type: "actions",
      block_id: "timeline_actions",
      elements: [{ type: "button" }],
    },
  ];

  const next = buildInactiveBlocks(blocks);

  assert.ok(next);
  assert.equal(
    next.some((block) => block.type === "actions"),
    false
  );
  assert.equal(next.includes(approvedSection), true);
  assert.match(JSON.stringify(next), /Approved by @ana/);
});

test("preserves a rejection decision", () => {
  const rejectedSection: IncomingSlackBlock = {
    type: "section",
    text: { type: "mrkdwn", text: "*Rejected by @bruno (U456)*" },
  };

  const next = buildInactiveBlocks([
    rejectedSection,
    { type: "actions", elements: [] },
  ]);

  assert.ok(next);
  assert.match(JSON.stringify(next), /Rejected by @bruno/);
});

test("adds the inactive notice as a context block", () => {
  const next = buildInactiveBlocks([approvedSection]);

  assert.ok(next);
  const last = next[next.length - 1];
  assert.equal(last.type, "context");
  assert.match(JSON.stringify(last), /This request is no longer active/);
});

test("returns null when Slack did not send blocks", () => {
  assert.equal(buildInactiveBlocks(undefined), null);
});

test("returns null when the block array is empty", () => {
  assert.equal(buildInactiveBlocks([]), null);
});

test("does not mutate the received blocks", () => {
  const blocks: IncomingSlackBlock[] = [
    approvedSection,
    { type: "actions", elements: [] },
  ];

  buildInactiveBlocks(blocks);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, "actions");
});
