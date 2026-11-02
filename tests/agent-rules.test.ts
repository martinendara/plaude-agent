import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRuleError,
  parseAgentFile,
  type TextRule,
} from "../lib/agent-rules.ts";

function parseRules(body: string): TextRule[] {
  return parseAgentFile("```rules\n" + body + "\n```").rules;
}

function isAgentRuleErrorOnLineTwo(error: unknown): boolean {
  return error instanceof AgentRuleError && error.line === 2;
}

test("parses a valid `is` rule with its line and reason", () => {
  const rules = parseRules(
    'rule unlock_account when account.lock_reason is suspected_fraud reason "Fraud lock needs review"'
  );

  assert.deepEqual(rules, [
    {
      line: 2,
      tool: "unlock_account",
      condition: {
        fact: "account.lock_reason",
        op: "is",
        value: "suspected_fraud",
      },
      reason: "Fraud lock needs review",
    },
  ]);
});

test("parses a valid `>` rule into integer cents", () => {
  const rules = parseRules(
    'rule refund_fee when amount_usd > 20 reason "Refunds above USD 20 are reviewed"'
  );

  assert.equal(rules.length, 1);
  assert.equal(rules[0].tool, "refund_fee");
  assert.deepEqual(rules[0].condition, {
    fact: "amount_usd",
    op: ">",
    valueCents: 2000,
  });
});

test("rejects an unknown fact and reports the failing line", () => {
  assert.throws(
    () => parseRules('rule refund_fee when balance_usd > 20 reason "x"'),
    (error: unknown) =>
      isAgentRuleErrorOnLineTwo(error) &&
      /unknown fact "balance_usd"/.test((error as AgentRuleError).message)
  );
});

test("rejects a tool outside the whitelist and reports the failing line", () => {
  assert.throws(
    () => parseRules('rule transfer_money when amount_usd > 20 reason "x"'),
    (error: unknown) =>
      isAgentRuleErrorOnLineTwo(error) &&
      /unknown tool "transfer_money"/.test((error as AgentRuleError).message)
  );
});

test("rejects `and` because there is no compound condition syntax", () => {
  assert.throws(
    () =>
      parseRules(
        'rule refund_fee when amount_usd > 20 and account.locked is true reason "x"'
      ),
    (error: unknown) => isAgentRuleErrorOnLineTwo(error)
  );
});

test("rejects `allow` because no rule can remove an approval", () => {
  assert.throws(
    () => parseRules('allow refund_fee when amount_usd > 20 reason "x"'),
    (error: unknown) => isAgentRuleErrorOnLineTwo(error)
  );
});

test("rejects `skip` because no rule can remove an approval", () => {
  assert.throws(
    () => parseRules('skip refund_fee when amount_usd > 20 reason "x"'),
    (error: unknown) => isAgentRuleErrorOnLineTwo(error)
  );
});
