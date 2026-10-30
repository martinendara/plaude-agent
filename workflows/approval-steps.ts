import { FatalError } from "workflow";

import type {
  ApprovalHookPayload,
  ApprovalRequest,
} from "@/lib/approval-types";
import { callSlack, requireEnv } from "@/lib/slack-api";
import { buildApprovalBlocks, buildDecisionBlocks } from "@/lib/slack-blocks";

type SlackMessageRef = {
  channelId: string;
  messageTs: string;
};

export async function createHookToken(): Promise<string> {
  "use step";

  return crypto.randomUUID();
}

function timelineUrl(runId: string): string | undefined {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");

  return base ? `${base}/operator/${runId}` : undefined;
}

export async function postApprovalMessage({
  token,
  request,
  runId,
}: {
  token: string;
  request: ApprovalRequest;
  runId: string;
}): Promise<SlackMessageRef> {
  "use step";

  const channelId = requireEnv("SLACK_APPROVALS_CHANNEL_ID");
  const response = await callSlack("chat.postMessage", {
    channel: channelId,
    text: `Approval needed: ${request.summary}`,
    blocks: buildApprovalBlocks({
      token,
      request,
      timelineUrl: timelineUrl(runId),
    }),
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
  runId,
}: {
  channelId: string;
  messageTs: string;
  request: ApprovalRequest;
  decision: ApprovalHookPayload | null;
  timeoutMs: number;
  runId: string;
}): Promise<void> {
  "use step";

  await callSlack("chat.update", {
    channel: channelId,
    ts: messageTs,
    text: decision
      ? `${decision.approved ? "Approved" : "Rejected"} by @${decision.approver.name} (${decision.approver.id})`
      : "Approval timed out",
    blocks: buildDecisionBlocks({
      request,
      decision,
      timeoutMs,
      timelineUrl: timelineUrl(runId),
    }),
  });
}
