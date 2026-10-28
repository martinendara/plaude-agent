export type ApprovalHookPayload = {
  approved: boolean;
  approver: string;
  decidedAt: string;
};

export type ApprovalDecision =
  | { status: "approved"; approver: string; decidedAt: string }
  | { status: "rejected"; approver: string; decidedAt: string }
  | { status: "timed_out" };
