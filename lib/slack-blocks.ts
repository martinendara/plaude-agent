import { formatUtc } from "@/lib/format-utc";
import type { ApprovalHookPayload } from "@/lib/approval-types";

type SlackBlock = {
  type: string;
  [key: string]: unknown;
};

export function buildApprovalBlocks({
  token,
  request,
}: {
  token: string;
  request: string;
}): SlackBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Approval needed", emoji: false },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${request}*` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Acme Wallet support agent · The decision is recorded in the run timeline.",
        },
      ],
    },
    {
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
    },
  ];
}

export function buildDecisionBlocks({
  request,
  decision,
  timeoutMs,
}: {
  request: string;
  decision: ApprovalHookPayload | null;
  timeoutMs: number;
}): SlackBlock[] {
  const minutes = Math.round(timeoutMs / 60_000);
  const outcome = decision
    ? `${decision.approved ? "Approved" : "Rejected"} by @${decision.approver} · ${formatUtc(decision.decidedAt)}`
    : `Timed out · no decision after ${minutes} minutes`;

  return [
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
      text: { type: "mrkdwn", text: request },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${outcome}*` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Acme Wallet support agent · Buttons were removed after the decision.",
        },
      ],
    },
  ];
}
