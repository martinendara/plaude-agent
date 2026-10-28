import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import type { ApprovalHookPayload } from "@/lib/approval-types";
import { isValidSlackRequest } from "@/lib/slack-verify";

type SlackInteraction = {
  type?: string;
  user?: { id?: string; name?: string };
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

  if (
    payload.type !== "block_actions" ||
    !token ||
    (actionId !== "approve" && actionId !== "reject")
  ) {
    return new Response("Unsupported action", { status: 400 });
  }

  const approval: ApprovalHookPayload = {
    approved: actionId === "approve",
    approver: payload.user?.name ?? payload.user?.id ?? "unknown",
    decidedAt: new Date().toISOString(),
  };

  try {
    await resumeHook(token, approval);
  } catch (error) {
    if (HookNotFoundError.is(error)) {
      return Response.json({ ok: true, note: "already resolved" });
    }

    throw error;
  }

  return Response.json({ ok: true });
}
