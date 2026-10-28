import { FatalError } from "workflow";

import type { ApprovalHookPayload } from "@/lib/approval-types";
import { buildApprovalBlocks, buildDecisionBlocks } from "@/lib/slack-blocks";

type SlackMessageRef = {
  channelId: string;
  messageTs: string;
};

type SlackResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

export async function createHookToken(): Promise<string> {
  "use step";

  return crypto.randomUUID();
}

export async function postApprovalMessage({
  token,
  request,
}: {
  token: string;
  request: string;
}): Promise<SlackMessageRef> {
  "use step";

  const channelId = requireEnv("SLACK_APPROVALS_CHANNEL_ID");
  const response = await callSlack("chat.postMessage", {
    channel: channelId,
    text: `Approval needed: ${request}`,
    blocks: buildApprovalBlocks({ token, request }),
  });

  if (!response.ts) {
    throw new FatalError("Slack chat.postMessage returned no message timestamp");
  }

  console.log(`Posted approval message ${response.ts} to ${channelId}`);

  return { channelId, messageTs: response.ts };
}

export async function updateApprovalMessage({
  channelId,
  messageTs,
  request,
  decision,
  timeoutMs,
}: {
  channelId: string;
  messageTs: string;
  request: string;
  decision: ApprovalHookPayload | null;
  timeoutMs: number;
}): Promise<void> {
  "use step";

  await callSlack("chat.update", {
    channel: channelId,
    ts: messageTs,
    text: decision
      ? `${decision.approved ? "Approved" : "Rejected"} by @${decision.approver}`
      : "Approval timed out",
    blocks: buildDecisionBlocks({ request, decision, timeoutMs }),
  });
}

async function callSlack(
  method: string,
  body: Record<string, unknown>
): Promise<SlackResponse> {
  const botToken = requireEnv("SLACK_BOT_TOKEN");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as SlackResponse;

  if (!data.ok) {
    throw new FatalError(
      `Slack ${method} failed: ${data.error ?? "unknown_error"}`
    );
  }

  return data;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new FatalError(`Missing environment variable: ${name}`);

  return value;
}
