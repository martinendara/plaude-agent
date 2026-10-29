export type Approver = {
  id: string;
  name: string;
};

export type ApprovalRequest = {
  summary: string;
  customerName?: string;
  amountCents?: number;
  rule?: string;
  details?: string;
};

export type ApprovalHookPayload = {
  approved: boolean;
  approver: Approver;
  decidedAt: string;
};

export type ApprovalDecision =
  | { status: "approved"; approver: Approver; decidedAt: string }
  | { status: "rejected"; approver: Approver; decidedAt: string }
  | { status: "timed_out" };
