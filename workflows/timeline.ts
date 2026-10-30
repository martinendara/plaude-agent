import { getWritable } from "workflow";

import type { ApprovalCustomer } from "@/lib/approval-types";

export type ActionTool =
  | "refund_fee"
  | "reverse_transaction"
  | "raise_limit"
  | "unlock_account";

export type TimelineRule = {
  label: string;
  source: "code" | "text";
};

export type TimelineResult = {
  status:
    | "completed"
    | "rejected"
    | "timed_out"
    | "refused"
    | "already_processed"
    | "in_progress"
    | "error";
  approval?: "not_required" | "approved";
  error?: string;
  message: string;
};

export type ActionTimelineRecord = {
  at: string;
  tool: ActionTool;
  input: Record<string, unknown>;
  customer: ApprovalCustomer;
  amountCents?: number;
  limits?: { currentCents: number; newCents: number };
  rules: TimelineRule[];
  approval?:
    | { decidedBy: { id: string; name: string }; decidedAt: string }
    | "timed_out";
  result: TimelineResult;
};

export type PendingTimelineEvent = {
  kind: "pending";
  at: string;
  summary: string;
  amountCents?: number;
  timeoutMs: number;
  customer?: ApprovalCustomer;
};

export type TimelineEvent = ActionTimelineRecord | PendingTimelineEvent;

type TimelineInput =
  | Omit<ActionTimelineRecord, "at">
  | Omit<PendingTimelineEvent, "at">;

// Streams must be written from a step, never from the workflow body.
export async function appendTimeline(event: TimelineInput): Promise<void> {
  "use step";

  const writable = getWritable<TimelineEvent>({ namespace: "timeline" });
  const writer = writable.getWriter();

  try {
    await writer.write({ ...event, at: new Date().toISOString() });
  } finally {
    writer.releaseLock();
  }
}
