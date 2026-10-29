import { createHook, sleep } from "workflow";

import type {
  ApprovalDecision,
  ApprovalHookPayload,
  ApprovalRequest,
} from "@/lib/approval-types";
import {
  createHookToken,
  postApprovalMessage,
  updateApprovalMessage,
} from "@/workflows/approval-steps";

// Workflow-level helper: no "use workflow" here, so tools can await it.
export async function requestApproval({
  request,
  timeoutMs,
}: {
  request: ApprovalRequest;
  timeoutMs: number;
}): Promise<ApprovalDecision> {
  const token = await createHookToken();
  const hook = createHook<ApprovalHookPayload>({ token });

  // Registration is committed when the workflow suspends. Do it before the
  // Slack message exposes the token, so an immediate click finds the hook.
  const conflict = await hook.getConflict();
  if (conflict) {
    throw new Error("Approval hook token is already in use");
  }

  const message = await postApprovalMessage({ token, request });

  const outcome = await Promise.race([
    hook.then((payload) => ({ type: "decision" as const, payload })),
    sleep(timeoutMs).then(() => ({ type: "timeout" as const })),
  ]);

  if (outcome.type === "timeout") {
    // A late click must not resume an approval the workflow already gave up on.
    hook.dispose();

    await updateApprovalMessage({
      ...message,
      request,
      decision: null,
      timeoutMs,
    });

    return { status: "timed_out" };
  }

  const { approved, approver, decidedAt } = outcome.payload;

  await updateApprovalMessage({
    ...message,
    request,
    decision: outcome.payload,
    timeoutMs,
  });

  return approved
    ? { status: "approved", approver, decidedAt }
    : { status: "rejected", approver, decidedAt };
}
