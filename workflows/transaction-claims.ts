import { createHook } from "workflow";

import { hookExists } from "@/workflows/claim-steps";

// A finished action keeps its token reserved so a later conversation, which
// starts from the pristine mock data, cannot apply the same action twice.
const DONE_RETENTION = "30d";

const lockToken = (transactionId: string) => `wallet-tx:${transactionId}`;
const doneToken = (transactionId: string) => `wallet-tx:${transactionId}:done`;

export type TransactionClaim =
  | {
      status: "claimed";
      release: () => void;
      markProcessed: () => Promise<void>;
    }
  | { status: "in_progress" }
  | { status: "already_processed" };

// Hook tokens are globally unique while active (Workflow DevKit run
// idempotency). The lock is released when the run ends or on release(); the
// done marker is retained for 30 days after a successful mutation.
export async function claimTransaction(
  transactionId: string
): Promise<TransactionClaim> {
  const lock = createHook({ token: lockToken(transactionId) });
  const conflict = await lock.getConflict();

  // Check after acquiring the lock: the holder creates the done marker before
  // releasing the lock, so a checker that owns the lock sees the final state.
  const processed = await hookExists(doneToken(transactionId));

  if (processed) {
    if (!conflict) lock.dispose();
    return { status: "already_processed" };
  }

  if (conflict) return { status: "in_progress" };

  return {
    status: "claimed",
    release: () => lock.dispose(),
    markProcessed: async () => {
      const marker = createHook({
        token: doneToken(transactionId),
        experimental_minRetention: DONE_RETENTION,
      });
      const markerConflict = await marker.getConflict();

      if (markerConflict) {
        console.warn(
          `Transaction ${transactionId} was already marked processed by run ${markerConflict.runId}`
        );
      }
    },
  };
}
