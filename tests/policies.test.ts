import assert from "node:assert/strict";
import test from "node:test";

import {
  checkOwnership,
  evaluateGuardrails,
  type ExtraPolicyRule,
  type PolicyContext,
} from "../lib/policies.ts";

const ana: PolicyContext = {
  customerId: "CUS-ANA",
  customerName: "Ana",
  accountLockedForFraud: false,
  locked: false,
  lockReason: null,
};

test("a fee refund of exactly USD 20 resolves without approval", () => {
  const result = evaluateGuardrails(
    { type: "refund_fee", amountCents: 2000 },
    ana
  );

  assert.equal(result.requiresApproval, false);
  assert.deepEqual(result.reasons, []);
});

test("a fee refund of USD 20.01 requires approval", () => {
  const result = evaluateGuardrails(
    { type: "refund_fee", amountCents: 2001 },
    ana
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["fee_refund_over_20"]
  );
});

test("a reversal of exactly USD 100 resolves when the recipient was not paid", () => {
  const result = evaluateGuardrails(
    {
      type: "reverse_transaction",
      amountCents: 10000,
      recipientReceived: false,
    },
    ana
  );

  assert.equal(result.requiresApproval, false);
  assert.deepEqual(result.reasons, []);
});

test("a reversal of USD 100.01 requires approval", () => {
  const result = evaluateGuardrails(
    {
      type: "reverse_transaction",
      amountCents: 10001,
      recipientReceived: false,
    },
    ana
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["reversal_over_100"]
  );
});

test("a reversal to a recipient who was already paid requires approval even below USD 100", () => {
  const result = evaluateGuardrails(
    {
      type: "reverse_transaction",
      amountCents: 500,
      recipientReceived: true,
    },
    ana
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["recipient_already_paid"]
  );
});

test("a limit increase to exactly 2x the current limit resolves without approval", () => {
  const result = evaluateGuardrails(
    { type: "raise_limit", currentLimitCents: 50000, newLimitCents: 100000 },
    ana
  );

  assert.equal(result.requiresApproval, false);
  assert.deepEqual(result.reasons, []);
});

test("a limit increase of one cent above 2x requires approval", () => {
  const result = evaluateGuardrails(
    { type: "raise_limit", currentLimitCents: 50000, newLimitCents: 100001 },
    ana
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["limit_over_2x"]
  );
});

test("unlocking an account locked for suspected fraud requires approval", () => {
  const result = evaluateGuardrails(
    { type: "unlock_account", lockReason: "suspected_fraud" },
    ana
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["fraud_lock"]
  );
});

test("refunds and reversals on a fraud-locked account require approval", () => {
  const fraudLocked: PolicyContext = {
    ...ana,
    accountLockedForFraud: true,
    locked: true,
    lockReason: "suspected_fraud",
  };

  const refund = evaluateGuardrails(
    { type: "refund_fee", amountCents: 100 },
    fraudLocked
  );
  const reversal = evaluateGuardrails(
    {
      type: "reverse_transaction",
      amountCents: 100,
      recipientReceived: false,
    },
    fraudLocked
  );

  assert.equal(refund.requiresApproval, true);
  assert.ok(
    refund.reasons.some((reason) => reason.code === "account_locked_fraud")
  );
  assert.equal(reversal.requiresApproval, true);
  assert.ok(
    reversal.reasons.some((reason) => reason.code === "account_locked_fraud")
  );
});

test("an action on another customer's account is refused even when approval would be required", () => {
  const action = {
    type: "reverse_transaction",
    amountCents: 50000,
    recipientReceived: false,
  } as const;

  assert.equal(evaluateGuardrails(action, ana).requiresApproval, true);
  assert.equal(checkOwnership("CUS-DIEGO", "CUS-ANA"), false);
  assert.equal(checkOwnership("CUS-ANA", "CUS-ANA"), true);
});

test("an extra rule can add approval where the code does not ask for it", () => {
  const extraRule: ExtraPolicyRule = (action) =>
    action.type === "refund_fee" && action.amountCents > 100
      ? {
          code: "text:refund_fee:2",
          label: "Any refund above USD 1",
          source: "text",
        }
      : null;

  const result = evaluateGuardrails(
    { type: "refund_fee", amountCents: 500 },
    ana,
    [extraRule]
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.source),
    ["text"]
  );
  assert.equal(result.reasons[0].label, "Any refund above USD 1");
});

test("an extra rule can never turn an approval into a solo decision", () => {
  const noOpinion: ExtraPolicyRule = () => null;
  const result = evaluateGuardrails(
    { type: "refund_fee", amountCents: 5000 },
    ana,
    [noOpinion]
  );

  assert.equal(result.requiresApproval, true);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["fee_refund_over_20"]
  );
});
