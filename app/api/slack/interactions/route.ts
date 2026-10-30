import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import type { ApprovalHookPayload } from "@/lib/approval-types";
import { isAuthorizedApprover, parseApproverIds } from "@/lib/approvers";
import { callSlack } from "@/lib/slack-api";
import { isValidSlackRequest } from "@/lib/slack-verify";

type SlackInteraction = {
  type?: string;
  channel?: { id?: string };
  user?: { id?: string; name?: string };
  message?: { ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const validSignature = isValidSlackRequest({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    signingSecret,
  });

  if (!validSignature) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payloadRaw = new URLSearchParams(rawBody).get("payload");
  if (!payloadRaw) {
    return new Response("Missing payload", { status: 400 });
  }

  let payload: SlackInteraction;
  try {
    payload = JSON.parse(payloadRaw) as SlackInteraction;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const action = payload.actions?.[0];
  const actionId = action?.action_id;
  const token = action?.value;

  // URL buttons can also arrive as block_actions. They are navigation only;
  // acknowledge so Slack does not show an error triangle.
  if (payload.type === "block_actions" && actionId === "view_timeline") {
    return Response.json({ ok: true });
  }

  if (
    payload.type !== "block_actions" ||
    !token ||
    (actionId !== "approve" && actionId !== "reject")
  ) {
    return new Response("Unsupported action", { status: 400 });
  }

  const userId = payload.user?.id;
  const approverIds = parseApproverIds(process.env.SLACK_APPROVER_IDS);

  if (approverIds.length === 0) {
    console.error(
      "SLACK_APPROVER_IDS is missing or empty: no Slack user can approve. The approval hook was not resumed."
    );
  }

  if (!isAuthorizedApprover(userId, approverIds)) {
    console.warn(
      `Rejected approval action from unauthorized Slack user ${userId ?? "unknown"}. The hook is still waiting.`
    );

    await notifyNotAuthorized({ channelId: payload.channel?.id, userId });

    return Response.json({ ok: true, note: "user not authorized" });
  }

  const approval: ApprovalHookPayload = {
    approved: actionId === "approve",
    approver: {
      id: userId ?? "unknown",
      name: payload.user?.name ?? userId ?? "unknown",
    },
    decidedAt: new Date().toISOString(),
  };

  try {
    await resumeHook(token, approval);
  } catch (error) {
    if (HookNotFoundError.is(error)) {
      await markRequestInactive({
        channelId: payload.channel?.id,
        messageTs: payload.message?.ts,
      });

      return Response.json({ ok: true, note: "no longer active" });
    }

    throw error;
  }

  return Response.json({ ok: true });
}

async function markRequestInactive({
  channelId,
  messageTs,
}: {
  channelId: string | undefined;
  messageTs: string | undefined;
}): Promise<void> {
  if (!channelId || !messageTs) return;

  try {
    await callSlack("chat.update", {
      channel: channelId,
      ts: messageTs,
      text: "This request is no longer active",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "This request is no longer active.",
          },
        },
      ],
    });
  } catch (error) {
    console.error("Could not mark the approval message inactive", error);
  }
}

async function notifyNotAuthorized({
  channelId,
  userId,
}: {
  channelId: string | undefined;
  userId: string | undefined;
}): Promise<void> {
  if (!channelId || !userId) return;

  try {
    await callSlack("chat.postEphemeral", {
      channel: channelId,
      user: userId,
      text: "You are not an authorized approver for Acme Wallet requests. This approval is still waiting for an authorized approver.",
    });
  } catch (error) {
    console.error("Could not send the not-authorized ephemeral message", error);
  }
}
