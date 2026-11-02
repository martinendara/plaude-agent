import assert from "node:assert/strict";
import { mock, test } from "node:test";

const claimCalls: unknown[] = [];
const approvalCalls: unknown[] = [];
const timelineCalls: unknown[] = [];

mock.module("@/workflows/transaction-claims", {
  namedExports: {
    claimTransaction: async (...args: unknown[]) => {
      claimCalls.push(args);
      return {
        status: "claimed",
        release: () => {},
        markProcessed: async () => {},
      };
    },
  },
});

mock.module("@/workflows/approval-request", {
  namedExports: {
    requestApproval: async (...args: unknown[]) => {
      approvalCalls.push(args);
      return {
        status: "approved",
        approver: { id: "U123", name: "Test Approver" },
        decidedAt: "2026-11-02T00:00:00.000Z",
      };
    },
  },
});

mock.module("@/workflows/timeline", {
  namedExports: {
    appendTimeline: async (...args: unknown[]) => {
      timelineCalls.push(args);
    },
  },
});

const { createAgentTools } = await import("../workflows/agent-tools.ts");
const { loadWallet } = await import("../lib/wallet.ts");

type ExecuteResult = {
  status?: string;
  message?: string;
  error?: string;
};

function session() {
  return createAgentTools({
    state: { wallet: loadWallet(), actionQueue: Promise.resolve() },
    customerId: "cus_diego",
    customerName: "Diego Torres",
    extraRules: [],
  });
}

async function refundFee(transactionId: string): Promise<ExecuteResult> {
  const execute = session().refund_fee.execute;
  assert.ok(execute);

  return (await execute(
    { transaction_id: transactionId, reason: "test" },
    { toolCallId: `call-${transactionId}`, messages: [] }
  )) as ExecuteResult;
}

async function reverseTransaction(
  transactionId: string
): Promise<ExecuteResult> {
  const execute = session().reverse_transaction.execute;
  assert.ok(execute);

  return (await execute(
    { transaction_id: transactionId, reason: "test" },
    { toolCallId: `call-${transactionId}`, messages: [] }
  )) as ExecuteResult;
}

function assertRefusedWithoutSideEffects(result: ExecuteResult): void {
  assert.equal(result.status, "refused");
  assert.match(result.message ?? "", /another customer/);
  assert.equal(claimCalls.length, 0);
  assert.equal(approvalCalls.length, 0);
}

test("refund_fee refuses another customer's transaction before claiming or asking", async () => {
  const result = await refundFee("TX-1041");

  assertRefusedWithoutSideEffects(result);
});

test("reverse_transaction refuses another customer's transaction before claiming or asking", async () => {
  const result = await reverseTransaction("TX-1042");

  assertRefusedWithoutSideEffects(result);
});
