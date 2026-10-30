import { tool } from "ai";
import { z } from "zod";

import { APPROVAL_TIMEOUT_MS } from "@/lib/approval-config";
import type { ApprovalCustomer, Approver } from "@/lib/approval-types";
import { dollarsToCents, formatUsd } from "@/lib/money";
import {
  checkOwnership,
  evaluateGuardrails,
  type ExtraPolicyRule,
  type PolicyContext,
  type PolicyReason,
} from "@/lib/policies";
import { customerSays } from "@/lib/slack-escape";
import {
  findAccount,
  findTransaction,
  type Wallet,
  type WalletAccount,
  type WalletMutation,
  WalletError,
} from "@/lib/wallet";
import { requestApproval } from "@/workflows/approval-request";
import { claimTransaction } from "@/workflows/transaction-claims";
import {
  appendTimeline,
  type ActionTimelineRecord,
  type ActionTool,
  type TimelineResult,
  type TimelineRule,
} from "@/workflows/timeline";
import { applyWalletMutation } from "@/workflows/wallet-steps";

export type SessionState = {
  wallet: Wallet;
  actionQueue: Promise<unknown>;
};

type ToolContext = {
  state: SessionState;
  customerId: string;
  customerName: string;
};

type ActionOutcome =
  | {
      status: "completed";
      approval: "not_required" | "approved";
      approver?: Approver;
      message: string;
    }
  | { status: "rejected"; approver: Approver; message: string }
  | { status: "timed_out"; message: string }
  | { status: "refused"; message: string }
  | { status: "already_processed"; message: string }
  | { status: "in_progress"; message: string }
  | { error: string; message: string };

function serializeAction<T>(
  state: SessionState,
  task: () => Promise<T>
): Promise<T> {
  const result = state.actionQueue.then(task, task);
  state.actionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function reasonsLabel(reasons: PolicyReason[]): string {
  return reasons.map((reason) => reason.label).join("; ");
}

function walletError(error: unknown): ActionOutcome {
  if (error instanceof WalletError) {
    return { error: error.code, message: "The action could not be applied." };
  }

  throw error;
}

function alreadyHandled(
  status: "already_processed" | "in_progress"
): ActionOutcome {
  return status === "already_processed"
    ? {
        status: "already_processed",
        message:
          "That transaction was already processed in another conversation. No new action was taken.",
      }
    : {
        status: "in_progress",
        message:
          "Another conversation is already handling that transaction. No new action was taken.",
      };
}

type ActionMeta = {
  rules: TimelineRule[];
  amountCents?: number;
  limits?: { currentCents: number; newCents: number };
  approval?: ActionTimelineRecord["approval"];
};

function resultOf(outcome: ActionOutcome): TimelineResult {
  if ("error" in outcome) {
    return {
      status: "error",
      error: outcome.error,
      message: outcome.message,
    };
  }

  return {
    status: outcome.status,
    ...("approval" in outcome ? { approval: outcome.approval } : {}),
    message: outcome.message,
  };
}

async function withTimelineResult(
  tool: ActionTool,
  input: Record<string, unknown>,
  customer: ApprovalCustomer,
  run: (meta: ActionMeta) => Promise<ActionOutcome>
): Promise<ActionOutcome> {
  const meta: ActionMeta = { rules: [] };
  let outcome: ActionOutcome | undefined;
  let failed = false;
  let failure: unknown;

  try {
    outcome = await run(meta);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    await appendTimeline({
      tool,
      input,
      customer,
      ...(meta.amountCents !== undefined
        ? { amountCents: meta.amountCents }
        : {}),
      ...(meta.limits !== undefined ? { limits: meta.limits } : {}),
      rules: meta.rules,
      ...(meta.approval !== undefined ? { approval: meta.approval } : {}),
      result: outcome
        ? resultOf(outcome)
        : {
            status: "error",
            error: "unexpected_error",
            message: "The action failed before producing a result.",
          },
    });
  }

  if (failed) throw failure;
  return outcome as ActionOutcome;
}

function notOwner(): ActionOutcome {
  return {
    status: "refused",
    message: "That transaction belongs to another customer. I cannot act on it.",
  };
}

async function apply(
  state: SessionState,
  mutation: WalletMutation
): Promise<void> {
  state.wallet = await applyWalletMutation(state.wallet, mutation);
}

export function createAgentTools({
  state,
  customerId,
  customerName,
  extraRules,
}: ToolContext & { extraRules: ExtraPolicyRule[] }) {
  function contextFor(account: WalletAccount): PolicyContext {
    return {
      customerId,
      customerName,
      accountLockedForFraud:
        account.lock.locked && account.lock.reason === "suspected_fraud",
      locked: account.lock.locked,
      lockReason: account.lock.reason,
    };
  }

  function customerSnapshot(): ApprovalCustomer {
    const account = findAccount(state.wallet, customerId);

    return {
      id: customerId,
      name: customerName,
      locked: account?.lock.locked ?? false,
      lockReason: account?.lock.reason ?? null,
    };
  }

  return {
    lookup_account: tool({
      description:
        "Read the session customer's account: balance, daily limit, lock status and transactions.",
      inputSchema: z.object({}),
      execute: async () => {
        const account = findAccount(state.wallet, customerId);
        if (!account) return { error: "account_not_found" };

        return {
          customer: { id: account.id, name: account.name },
          balance: formatUsd(account.balanceCents),
          daily_limit: formatUsd(account.dailyLimitCents),
          lock: account.lock,
          transactions: account.transactions.map((transaction) => ({
            id: transaction.id,
            type: transaction.type,
            amount: formatUsd(transaction.amountCents),
            status: transaction.status,
            description: transaction.description,
            fee_refunded: transaction.feeRefunded ?? false,
            recipient_received: transaction.recipientReceived ?? true,
          })),
        };
      },
    }),

    refund_fee: tool({
      description:
        "Refund a fee. Pass only the fee transaction ID and the customer's reason; the amount is read from the wallet. The code decides whether a human approval is needed, including on a fraud-locked account. Call the tool; do not refuse on your own.",
      inputSchema: z.object({
        transaction_id: z
          .string()
          .describe("Fee transaction ID, for example TX-1041"),
        reason: z.string().describe("The customer's reason for the refund"),
      }),
      execute: async ({ transaction_id, reason }) =>
        serializeAction(state, async (): Promise<ActionOutcome> => {
          return withTimelineResult(
            "refund_fee",
            { transaction_id, reason },
            customerSnapshot(),
            async (meta) => {
              const found = findTransaction(state.wallet, transaction_id);
              if (!found) {
                return {
                  error: "transaction_not_found",
                  message: "No transaction with that ID was found.",
                };
              }
              if (!checkOwnership(customerId, found.account.id)) return notOwner();

              meta.amountCents = found.transaction.amountCents;

              const claim = await claimTransaction(transaction_id);
              if (claim.status !== "claimed") return alreadyHandled(claim.status);

              try {
                const transaction = found.transaction;
                if (transaction.type !== "fee") {
                  return {
                    error: "not_a_fee",
                    message: "That transaction is not a fee.",
                  };
                }
                if (transaction.feeRefunded) {
                  return {
                    error: "already_done",
                    message: "That fee was already refunded.",
                  };
                }

                const amountCents = transaction.amountCents;
                const { requiresApproval, reasons } = evaluateGuardrails(
                  { type: "refund_fee", amountCents },
                  contextFor(found.account),
                  extraRules
                );

                meta.rules = reasons.map((reason) => ({
                label: reason.label,
                source: reason.source,
              }));
                if (requiresApproval) {
                  const decision = await requestApproval({
                    request: {
                      summary: `Refund fee ${transaction.id}`,
                      customer: customerSnapshot(),
                      customerName,
                      amountCents,
                      rule: reasonsLabel(reasons),
                      details: `${transaction.description}. ${customerSays(reason)}`,
                    },
                    timeoutMs: APPROVAL_TIMEOUT_MS,
                    rules: meta.rules,
                  });

                  meta.approval =
                    decision.status === "timed_out"
                      ? "timed_out"
                      : { decidedBy: decision.approver, decidedAt: decision.decidedAt };

                  if (decision.status === "rejected") {
                    return {
                      status: "rejected",
                      approver: decision.approver,
                      message: "The refund was rejected; no money moved.",
                    };
                  }
                  if (decision.status === "timed_out") {
                    return {
                      status: "timed_out",
                      message:
                        "No approver answered in time; nothing was refunded.",
                    };
                  }

                  await apply(state, {
                    type: "refund_fee",
                    customerId,
                    transactionId: transaction.id,
                    amountCents,
                  });

                  await claim.markProcessed();
                  return {
                    status: "completed",
                    approval: "approved",
                    approver: decision.approver,
                    message: `Refunded ${formatUsd(amountCents)} for ${transaction.id}.`,
                  };
                }

                await apply(state, {
                  type: "refund_fee",
                  customerId,
                  transactionId: transaction.id,
                  amountCents,
                });

                await claim.markProcessed();
                return {
                  status: "completed",
                  approval: "not_required",
                  message: `Refunded ${formatUsd(amountCents)} for ${transaction.id}.`,
                };
              } finally {
                claim.release();
              }
          });
        }).catch(walletError),
    }),

    reverse_transaction: tool({
      description:
        "Reverse a transfer. Pass only the transfer ID and the customer's reason; the amount and whether the recipient already received the money are read from the wallet. Missing recipient data is treated as received. A fraud lock adds approval; call the tool and let the code decide.",
      inputSchema: z.object({
        transaction_id: z
          .string()
          .describe("Transfer ID, for example TX-1042"),
        reason: z.string().describe("The customer's reason for the reversal"),
      }),
      execute: async ({ transaction_id, reason }) =>
        serializeAction(state, async (): Promise<ActionOutcome> => {
          return withTimelineResult(
            "reverse_transaction",
            { transaction_id, reason },
            customerSnapshot(),
            async (meta) => {
              const found = findTransaction(state.wallet, transaction_id);
              if (!found) {
                return {
                  error: "transaction_not_found",
                  message: "No transaction with that ID was found.",
                };
              }
              if (!checkOwnership(customerId, found.account.id)) return notOwner();

              meta.amountCents = found.transaction.amountCents;

              const claim = await claimTransaction(transaction_id);
              if (claim.status !== "claimed") return alreadyHandled(claim.status);

              try {
                const transaction = found.transaction;
                if (transaction.type !== "transfer") {
                  return {
                    error: "not_a_transfer",
                    message: "That transaction is not a transfer.",
                  };
                }
                if (transaction.status === "reversed") {
                  return {
                    error: "already_done",
                    message: "That transfer was already reversed.",
                  };
                }

                const amountCents = transaction.amountCents;
                const { requiresApproval, reasons } = evaluateGuardrails(
                  {
                    type: "reverse_transaction",
                    amountCents,
                    recipientReceived: transaction.recipientReceived ?? true,
                  },
                  contextFor(found.account),
                  extraRules
                );

                meta.rules = reasons.map((reason) => ({
                label: reason.label,
                source: reason.source,
              }));
                if (requiresApproval) {
                  const decision = await requestApproval({
                    request: {
                      summary: `Reverse transfer ${transaction.id}`,
                      customer: customerSnapshot(),
                      customerName,
                      amountCents,
                      rule: reasonsLabel(reasons),
                      details: `${transaction.description}. ${customerSays(reason)}`,
                    },
                    timeoutMs: APPROVAL_TIMEOUT_MS,
                    rules: meta.rules,
                  });

                  meta.approval =
                    decision.status === "timed_out"
                      ? "timed_out"
                      : { decidedBy: decision.approver, decidedAt: decision.decidedAt };

                  if (decision.status === "rejected") {
                    return {
                      status: "rejected",
                      approver: decision.approver,
                      message: "The reversal was rejected; no money moved.",
                    };
                  }
                  if (decision.status === "timed_out") {
                    return {
                      status: "timed_out",
                      message:
                        "No approver answered in time; nothing was reversed.",
                    };
                  }

                  await apply(state, {
                    type: "reverse_transaction",
                    customerId,
                    transactionId: transaction.id,
                  });

                  await claim.markProcessed();
                  return {
                    status: "completed",
                    approval: "approved",
                    approver: decision.approver,
                    message: `Reversed ${formatUsd(amountCents)} for ${transaction.id}.`,
                  };
                }

                await apply(state, {
                  type: "reverse_transaction",
                  customerId,
                  transactionId: transaction.id,
                });

                await claim.markProcessed();
                return {
                  status: "completed",
                  approval: "not_required",
                  message: `Reversed ${formatUsd(amountCents)} for ${transaction.id}.`,
                };
              } finally {
                claim.release();
              }
          });
        }).catch(walletError),
    }),

    raise_limit: tool({
      description:
        "Raise the session customer's daily limit. Pass the new limit in USD; the current limit is read from the wallet and the code validates and decides on approval.",
      inputSchema: z.object({
        new_daily_limit: z
          .number()
          .describe("New daily limit in USD, for example 1500"),
      }),
      execute: async ({ new_daily_limit }) =>
        serializeAction(state, async (): Promise<ActionOutcome> => {
          return withTimelineResult(
            "raise_limit",
            { new_daily_limit },
            customerSnapshot(),
            async (meta) => {
              if (!Number.isFinite(new_daily_limit)) {
                return {
                  error: "invalid_limit",
                  message: "The new limit must be a positive number.",
                };
              }

              const newLimitCents = dollarsToCents(new_daily_limit);
              const account = findAccount(state.wallet, customerId);
              if (!account) {
                return { error: "account_not_found", message: "Account not found." };
              }

              meta.limits = {
                currentCents: account.dailyLimitCents,
                newCents: newLimitCents,
              };

            if (newLimitCents <= 0) {
                return {
                  error: "invalid_limit",
                  message: "The new limit must be positive.",
                };
              }

              if (newLimitCents <= account.dailyLimitCents) {
                return {
                  error: "limit_not_increased",
                  message: "The new limit must be higher than the current limit.",
                };
              }

              const { requiresApproval, reasons } = evaluateGuardrails(
                {
                  type: "raise_limit",
                  currentLimitCents: account.dailyLimitCents,
                  newLimitCents,
                },
                contextFor(account),
                extraRules
              );

              meta.rules = reasons.map((reason) => ({
                label: reason.label,
                source: reason.source,
              }));
              if (requiresApproval) {
                const decision = await requestApproval({
                  request: {
                    summary: `Raise daily limit to ${formatUsd(newLimitCents)}`,
                    customer: customerSnapshot(),
                      customerName,
                    amountCents: newLimitCents,
                    limitChange: {
                      currentCents: account.dailyLimitCents,
                      newCents: newLimitCents,
                    },
                    rule: reasonsLabel(reasons),
                    details: `Current limit: ${formatUsd(account.dailyLimitCents)}. Requested limit: ${formatUsd(newLimitCents)}.`,
                  },
                  timeoutMs: APPROVAL_TIMEOUT_MS,
                  rules: meta.rules,
                });

                meta.approval =
                  decision.status === "timed_out"
                    ? "timed_out"
                    : { decidedBy: decision.approver, decidedAt: decision.decidedAt };

                if (decision.status === "rejected") {
                  return {
                    status: "rejected",
                    approver: decision.approver,
                    message: "The limit increase was rejected; nothing changed.",
                  };
                }
                if (decision.status === "timed_out") {
                  return {
                    status: "timed_out",
                    message:
                      "No approver answered in time; the limit did not change.",
                  };
                }

                await apply(state, {
                  type: "raise_limit",
                  customerId,
                  newDailyLimitCents: newLimitCents,
                });

                return {
                  status: "completed",
                  approval: "approved",
                  approver: decision.approver,
                  message: `Daily limit raised to ${formatUsd(newLimitCents)}.`,
                };
              }

              await apply(state, {
                type: "raise_limit",
                customerId,
                newDailyLimitCents: newLimitCents,
              });

              return {
                status: "completed",
                approval: "not_required",
                message: `Daily limit raised to ${formatUsd(newLimitCents)}.`,
              };
          });
        }).catch(walletError),
    }),

    unlock_account: tool({
      description:
        "Unlock the session customer's account. Pass the customer's reason; the lock reason is read from the wallet and the code decides on approval.",
      inputSchema: z.object({
        reason: z.string().describe("The customer's reason for the unlock"),
      }),
      execute: async ({ reason }) =>
        serializeAction(state, async (): Promise<ActionOutcome> => {
          return withTimelineResult(
            "unlock_account",
            { reason },
            customerSnapshot(),
            async (meta) => {
              const account = findAccount(state.wallet, customerId);
              if (!account) {
                return { error: "account_not_found", message: "Account not found." };
              }
              if (!account.lock.locked) {
                return {
                  error: "already_unlocked",
                  message: "The account is not locked.",
                };
              }

              const { requiresApproval, reasons } = evaluateGuardrails(
                { type: "unlock_account", lockReason: account.lock.reason },
                contextFor(account),
                extraRules
              );

              meta.rules = reasons.map((reason) => ({
                label: reason.label,
                source: reason.source,
              }));
              if (requiresApproval) {
                const decision = await requestApproval({
                  request: {
                    summary: "Unlock account",
                    customer: customerSnapshot(),
                      customerName,
                    rule: reasonsLabel(reasons),
                    details: `Lock reason: ${account.lock.reason}. ${customerSays(reason)}`,
                  },
                  timeoutMs: APPROVAL_TIMEOUT_MS,
                  rules: meta.rules,
                });

                meta.approval =
                  decision.status === "timed_out"
                    ? "timed_out"
                    : { decidedBy: decision.approver, decidedAt: decision.decidedAt };

                if (decision.status === "rejected") {
                  return {
                    status: "rejected",
                    approver: decision.approver,
                    message: "The unlock was rejected; the account is still locked.",
                  };
                }
                if (decision.status === "timed_out") {
                  return {
                    status: "timed_out",
                    message:
                      "No approver answered in time; the account is still locked.",
                  };
                }

                await apply(state, { type: "unlock_account", customerId });

                return {
                  status: "completed",
                  approval: "approved",
                  approver: decision.approver,
                  message: "The account was unlocked.",
                };
              }

              await apply(state, { type: "unlock_account", customerId });

              return {
                status: "completed",
                approval: "not_required",
                message: "The account was unlocked.",
              };
          });
        }).catch(walletError),
    }),
  };
}
