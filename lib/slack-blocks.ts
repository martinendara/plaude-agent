import type {
  ApprovalHookPayload,
  ApprovalRequest,
} from "@/lib/approval-types";
import { formatUtc } from "@/lib/format-utc";
import { formatUsd } from "@/lib/money";

type SlackBlock = {
  type: string;
  [key: string]: unknown;
};

export function buildApprovalBlocks({
  token,
  request,
}: {
  token: string;
  request: ApprovalRequest;
}): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Approval needed", emoji: false },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${request.summary}*` },
    },
  ];

  const fields: Array<{ type: "mrkdwn"; text: string }> = [];

  if (request.customerName) {
    fields.push({
      type: "mrkdwn",
      text: `*Customer*\n${request.customerName}`,
    });
  }

  if (request.amountCents !== undefined) {
    fields.push({
      type: "mrkdwn",
      text: `*Amount*\n*${formatUsd(request.amountCents)}*`,
    });
  }

  if (request.rule) {
    fields.push({ type: "mrkdwn", text: `*Rule*\n${request.rule}` });
  }

  if (fields.length > 0) {
    blocks.push({ type: "section", fields });
  }

  if (request.details) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: request.details },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Acme Wallet support agent · The decision is recorded in the run timeline.",
      },
    ],
  });

  blocks.push({
    type: "actions",
    block_id: "approval_actions",
    elements: [
      {
        type: "button",
        action_id: "approve",
        style: "primary",
        text: { type: "plain_text", text: "Approve", emoji: false },
        value: token,
      },
      {
        type: "button",
        action_id: "reject",
        style: "danger",
        text: { type: "plain_text", text: "Reject", emoji: false },
        value: token,
      },
    ],
  });

  return blocks;
}

export function buildDecisionBlocks({
  request,
  decision,
  timeoutMs,
}: {
  request: ApprovalRequest;
  decision: ApprovalHookPayload | null;
  timeoutMs: number;
}): SlackBlock[] {
  const minutes = Math.round(timeoutMs / 60_000);
  const outcome = decision
    ? `${decision.approved ? "Approved" : "Rejected"} by @${decision.approver.name} (${decision.approver.id}) · ${formatUtc(decision.decidedAt)}`
    : `Timed out · no decision after ${minutes} minutes`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: decision ? "Approval decision" : "Approval timed out",
        emoji: false,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: request.summary },
    },
  ];

  const contextParts = [
    request.customerName,
    request.amountCents !== undefined
      ? formatUsd(request.amountCents)
      : undefined,
  ].filter((part): part is string => part !== undefined);

  if (contextParts.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: contextParts.join(" · ") }],
    });
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*${outcome}*` },
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Acme Wallet support agent · Buttons were removed after the decision.",
      },
    ],
  });

  return blocks;
}
