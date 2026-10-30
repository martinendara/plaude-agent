import type { LockReason } from "./wallet";

export type PolicyAction =
  | { type: "refund_fee"; amountCents: number }
  | {
      type: "reverse_transaction";
      amountCents: number;
      recipientReceived: boolean;
    }
  | {
      type: "raise_limit";
      currentLimitCents: number;
      newLimitCents: number;
    }
  | { type: "unlock_account"; lockReason: LockReason };

export type PolicyReason = {
  code: string;
  label: string;
};

export type PolicyContext = {
  customerId: string;
  customerName: string;
  accountLockedForFraud: boolean;
  locked: boolean;
  lockReason: LockReason;
};

export type ExtraPolicyRule = (
  action: PolicyAction,
  context: PolicyContext
) => PolicyReason | null;

type CodeRule = (
  action: PolicyAction,
  context: PolicyContext
) => PolicyReason | null;

// Code rules are immutable. Plain-text rules can add reasons, never remove these.
const CODE_RULES: CodeRule[] = [
  (action, context) =>
    context.accountLockedForFraud &&
    (action.type === "refund_fee" || action.type === "reverse_transaction")
      ? {
          code: "account_locked_fraud",
          label: "Account locked for suspected fraud",
        }
      : null,
  (action) =>
    action.type === "refund_fee" && action.amountCents > 2000
      ? { code: "fee_refund_over_20", label: "Fee refund above USD 20" }
      : null,
  (action) =>
    action.type === "reverse_transaction" && action.amountCents > 10000
      ? {
          code: "reversal_over_100",
          label: "Transfer reversal above USD 100",
        }
      : null,
  (action) =>
    action.type === "reverse_transaction" && action.recipientReceived
      ? {
          code: "recipient_already_paid",
          label: "Recipient already received the funds",
        }
      : null,
  (action) =>
    action.type === "raise_limit" &&
    action.newLimitCents > action.currentLimitCents * 2
      ? {
          code: "limit_over_2x",
          label: "New limit is more than 2x the current limit",
        }
      : null,
  (action) =>
    action.type === "unlock_account" &&
    action.lockReason === "suspected_fraud"
      ? {
          code: "fraud_lock",
          label: "Account is locked for suspected fraud",
        }
      : null,
];

export function evaluateGuardrails(
  action: PolicyAction,
  context: PolicyContext,
  extraRules: ExtraPolicyRule[] = []
): { requiresApproval: boolean; reasons: PolicyReason[] } {
  const codeReasons = CODE_RULES.map((rule) => rule(action, context)).filter(
    (reason): reason is PolicyReason => reason !== null
  );

  // Extra rules can only add approval reasons. They cannot clear the code rules.
  const extraReasons = extraRules
    .map((rule) => rule(action, context))
    .filter((reason): reason is PolicyReason => reason !== null);

  const reasons = [...codeReasons, ...extraReasons];

  return { requiresApproval: reasons.length > 0, reasons };
}

export function checkOwnership(
  sessionCustomerId: string,
  ownerCustomerId: string
): boolean {
  return sessionCustomerId === ownerCustomerId;
}
