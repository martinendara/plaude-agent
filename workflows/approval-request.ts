import { createHook, getWorkflowMetadata, sleep } from "workflow";

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
import { appendTimeline, type TimelineRule } from "@/workflows/timeline";

// Workflow-level helper: no "use workflow" here, so tools can await it.
export async function requestApproval({
  request,
  timeoutMs,
  rules,
}: {
  request: ApprovalRequest;
  timeoutMs: number;
  rules?: TimelineRule[];
}): Promise<ApprovalDecision> {
  const { workflowRunId } = getWorkflowMetadata();
  const token = await createHookToken();
  const hook = createHook<ApprovalHookPayload>({ token });

  // Registration is committed when the workflow suspends. Do it before the
  // Slack message exposes the token, so an immediate click finds the hook.
  const conflict = await hook.getConflict();
  if (conflict) {
    throw new Error("Approval hook token is already in use");
  }

  const message = await postApprovalMessage({
    token,
    request,
    runId: workflowRunId,
  });

  await appendTimeline({
    kind: "pending",
    summary: request.summary,
    timeoutMs,
    ...(request.amountCents !== undefined
      ? { amountCents: request.amountCents }
      : {}),
    ...(request.customer ? { customer: request.customer } : {}),
    ...(rules && rules.length > 0 ? { rules } : {}),
  });

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
      runId: workflowRunId,
    });

    return { status: "timed_out" };
  }

  const { approved, approver, decidedAt } = outcome.payload;

  await updateApprovalMessage({
    ...message,
    request,
    decision: outcome.payload,
    timeoutMs,
    runId: workflowRunId,
  });

  return approved
    ? { status: "approved", approver, decidedAt }
    : { status: "rejected", approver, decidedAt };
}
