import type {
  ExtraPolicyRule,
  PolicyAction,
  PolicyContext,
} from "./policies";
import type { LockReason } from "./wallet";

export type RuleTool =
  | "refund_fee"
  | "reverse_transaction"
  | "raise_limit"
  | "unlock_account";

export type RuleFact =
  | "account.locked"
  | "account.lock_reason"
  | "amount_usd"
  | "recipient_received"
  | "current_limit_usd"
  | "new_limit_usd";

type MoneyFact = "amount_usd" | "current_limit_usd" | "new_limit_usd";

export type RuleCondition =
  | { fact: "account.locked"; op: "is"; value: boolean }
  | { fact: "account.lock_reason"; op: "is"; value: LockReason }
  | {
      fact: "recipient_received";
      op: "is";
      value: boolean;
    }
  | { fact: MoneyFact; op: "is" | ">"; valueCents: number };

export type TextRule = {
  line: number;
  tool: RuleTool;
  condition: RuleCondition;
  reason: string;
};

export type ParsedAgentFile = {
  prompt: string;
  rules: TextRule[];
};

const TOOL_FACTS: Record<RuleTool, readonly RuleFact[]> = {
  refund_fee: ["account.locked", "account.lock_reason", "amount_usd"],
  reverse_transaction: [
    "account.locked",
    "account.lock_reason",
    "amount_usd",
    "recipient_received",
  ],
  raise_limit: [
    "account.locked",
    "account.lock_reason",
    "current_limit_usd",
    "new_limit_usd",
  ],
  unlock_account: ["account.locked", "account.lock_reason"],
};

const LOCK_REASONS: readonly LockReason[] = [
  "suspected_fraud",
  "lost_card",
  "security_review",
  null,
];

const MONEY_FACTS: readonly MoneyFact[] = [
  "amount_usd",
  "current_limit_usd",
  "new_limit_usd",
];

const MAX_RULES = 50;
const MAX_LINE_LENGTH = 300;
const MAX_REASON_LENGTH = 120;

const RULE_PATTERN =
  /^rule\s+([a-z_]+)\s+when\s+([a-z_.]+)\s+(is|>)\s+(.+?)\s+reason\s+"([^"]*)"\s*$/;

export class AgentRuleError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = "AgentRuleError";
    this.line = line;
  }
}

function isTool(value: string): value is RuleTool {
  return Object.prototype.hasOwnProperty.call(TOOL_FACTS, value);
}

function isFact(value: string): value is RuleFact {
  return (
    value === "account.locked" ||
    value === "account.lock_reason" ||
    value === "amount_usd" ||
    value === "recipient_received" ||
    value === "current_limit_usd" ||
    value === "new_limit_usd"
  );
}

function parseCents(line: number, raw: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new AgentRuleError(
      line,
      `"${raw}" is not a USD amount with at most two decimals`
    );
  }

  const cents = Math.round(Number(raw) * 100);

  if (!Number.isSafeInteger(cents) || cents > 100_000_000) {
    throw new AgentRuleError(line, `"${raw}" is outside the allowed range`);
  }

  return cents;
}

function parseRuleLine(line: number, text: string): TextRule {
  if (text.length > MAX_LINE_LENGTH) {
    throw new AgentRuleError(
      line,
      `rule line is longer than ${MAX_LINE_LENGTH} characters`
    );
  }

  const match = RULE_PATTERN.exec(text);

  if (!match) {
    throw new AgentRuleError(
      line,
      'expected: rule <tool> when <fact> is|> <value> reason "<text>"'
    );
  }

  const [, toolRaw, factRaw, opRaw, literalRaw, reasonRaw] = match;

  if (!isTool(toolRaw)) {
    throw new AgentRuleError(line, `unknown tool "${toolRaw}"`);
  }

  if (!isFact(factRaw)) {
    throw new AgentRuleError(line, `unknown fact "${factRaw}"`);
  }

  const allowedFacts = TOOL_FACTS[toolRaw];

  if (!allowedFacts.includes(factRaw)) {
    throw new AgentRuleError(
      line,
      `fact "${factRaw}" is not available for tool "${toolRaw}"`
    );
  }

  const reason = reasonRaw.trim();

  if (reason.length === 0) {
    throw new AgentRuleError(line, "reason must not be empty");
  }

  if (reason.length > MAX_REASON_LENGTH) {
    throw new AgentRuleError(
      line,
      `reason is longer than ${MAX_REASON_LENGTH} characters`
    );
  }

  if (opRaw === ">") {
    if (!MONEY_FACTS.includes(factRaw as MoneyFact)) {
      throw new AgentRuleError(
        line,
        `operator ">" only applies to USD facts, not "${factRaw}"`
      );
    }

    return {
      line,
      tool: toolRaw,
      condition: {
        fact: factRaw as MoneyFact,
        op: ">",
        valueCents: parseCents(line, literalRaw),
      },
      reason,
    };
  }

  if (factRaw === "account.locked" || factRaw === "recipient_received") {
    if (literalRaw !== "true" && literalRaw !== "false") {
      throw new AgentRuleError(
        line,
        `"${factRaw}" only accepts true or false`
      );
    }

    return {
      line,
      tool: toolRaw,
      condition: {
        fact: factRaw,
        op: "is",
        value: literalRaw === "true",
      },
      reason,
    };
  }

  if (factRaw === "account.lock_reason") {
    const value =
      literalRaw === "none" ? null : (literalRaw as LockReason);

    if (!LOCK_REASONS.includes(value)) {
      throw new AgentRuleError(
        line,
        `unknown lock reason "${literalRaw}"`
      );
    }

    return {
      line,
      tool: toolRaw,
      condition: { fact: "account.lock_reason", op: "is", value },
      reason,
    };
  }

  return {
    line,
    tool: toolRaw,
    condition: {
      fact: factRaw as MoneyFact,
      op: "is",
      valueCents: parseCents(line, literalRaw),
    },
    reason,
  };
}

function canonical(rule: TextRule): string {
  const condition = rule.condition;

  return "valueCents" in condition
    ? `${rule.tool}|${condition.fact}|${condition.op}|${condition.valueCents}`
    : `${rule.tool}|${condition.fact}|${condition.op}|${String(condition.value)}`;
}

export function parseAgentFile(markdown: string): ParsedAgentFile {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<{ start: number; end: number }> = [];
  let open = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (/^```rules\s*$/.test(line)) {
      if (open !== -1) {
        throw new AgentRuleError(
          index + 1,
          "nested `rules` block; close the previous one first"
        );
      }
      open = index;
    } else if (/^```\s*$/.test(line) && open !== -1) {
      blocks.push({ start: open, end: index });
      open = -1;
    }
  }

  if (open !== -1) {
    throw new AgentRuleError(open + 1, "`rules` block is not closed");
  }

  if (blocks.length > 1) {
    throw new AgentRuleError(
      blocks[1].start + 1,
      "only one `rules` block is allowed"
    );
  }

  const rules: TextRule[] = [];
  const seen = new Set<string>();

  if (blocks.length === 1) {
    const { start, end } = blocks[0];

    for (let index = start + 1; index < end; index += 1) {
      const text = lines[index].trim();

      if (text.length === 0 || text.startsWith("#")) continue;

      const rule = parseRuleLine(index + 1, text);
      const key = canonical(rule);

      if (seen.has(key)) {
        throw new AgentRuleError(index + 1, "duplicate rule");
      }

      seen.add(key);
      rules.push(rule);
    }
  }

  if (rules.length > MAX_RULES) {
    throw new AgentRuleError(
      blocks[0].start + 1,
      `more than ${MAX_RULES} rules`
    );
  }

  const prompt = lines
    .filter((_, index) => {
      if (blocks.length === 0) return true;
      return index < blocks[0].start || index > blocks[0].end;
    })
    .join("\n")
    .trim();

  return { prompt, rules };
}

function compareCents(
  op: "is" | ">",
  actual: number,
  expected: number
): boolean {
  return op === "is" ? actual === expected : actual > expected;
}

function conditionHolds(
  condition: RuleCondition,
  action: PolicyAction,
  context: PolicyContext
): boolean {
  switch (condition.fact) {
    case "account.locked":
      return context.locked === condition.value;
    case "account.lock_reason":
      return (context.lockReason ?? null) === condition.value;
    case "recipient_received":
      return (
        action.type === "reverse_transaction" &&
        action.recipientReceived === condition.value
      );
    case "amount_usd":
      return (
        (action.type === "refund_fee" ||
          action.type === "reverse_transaction") &&
        compareCents(condition.op, action.amountCents, condition.valueCents)
      );
    case "current_limit_usd":
      return (
        action.type === "raise_limit" &&
        compareCents(
          condition.op,
          action.currentLimitCents,
          condition.valueCents
        )
      );
    case "new_limit_usd":
      return (
        action.type === "raise_limit" &&
        compareCents(
          condition.op,
          action.newLimitCents,
          condition.valueCents
        )
      );
  }
}

function assertGeneratedRule(rule: TextRule): void {
  if (!isTool(rule.tool)) {
    throw new AgentRuleError(
      rule.line,
      `unknown tool "${String(rule.tool)}" in generated rules`
    );
  }

  if (!TOOL_FACTS[rule.tool].includes(rule.condition?.fact)) {
    throw new AgentRuleError(
      rule.line,
      `fact is not available for tool "${rule.tool}" in generated rules`
    );
  }

  if (
    typeof rule.reason !== "string" ||
    rule.reason.trim().length === 0 ||
    rule.reason.length > MAX_REASON_LENGTH
  ) {
    throw new AgentRuleError(rule.line, "invalid reason in generated rules");
  }

  const condition = rule.condition;

  switch (condition.fact) {
    case "account.locked":
    case "recipient_received":
      if (condition.op !== "is" || typeof condition.value !== "boolean") {
        throw new AgentRuleError(rule.line, "invalid boolean condition");
      }
      break;
    case "account.lock_reason":
      if (
        condition.op !== "is" ||
        !LOCK_REASONS.includes(condition.value)
      ) {
        throw new AgentRuleError(rule.line, "invalid lock reason condition");
      }
      break;
    case "amount_usd":
    case "current_limit_usd":
    case "new_limit_usd":
      if (
        (condition.op !== "is" && condition.op !== ">") ||
        !Number.isSafeInteger(condition.valueCents) ||
        condition.valueCents < 0
      ) {
        throw new AgentRuleError(rule.line, "invalid USD condition");
      }
      break;
    default:
      throw new AgentRuleError(
        rule.line,
        `unknown fact "${String(
          (condition as { fact?: unknown }).fact
        )}" in generated rules`
      );
  }
}

export function compileTextRules(rules: TextRule[]): ExtraPolicyRule[] {
  return rules.map((rule) => {
    assertGeneratedRule(rule);

    return (action, context) => {
      if (action.type !== rule.tool) return null;

      return conditionHolds(rule.condition, action, context)
        ? {
            code: `text:${rule.tool}:${rule.line}`,
            label: rule.reason,
            source: "text",
          }
        : null;
    };
  });
}
