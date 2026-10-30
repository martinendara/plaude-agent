# Plaude Agent

Customer support agent for Acme Wallet (a mock digital wallet), built for the Plaude engineering challenge.

**Current stage:** Stage 3 complete — the agent behavior lives in `instructions/agent.md`, the text can add approval rules, and transaction actions are claimed across conversations. Stage 4 (the designed UI and the operator timeline) comes next.

## What exists now

- Next.js 16 (App Router, TypeScript strict, Tailwind CSS 4) in `app/`.
- Workflow DevKit configured with `withWorkflow()` in `next.config.ts`.
- `workflows/approval.ts`: a durable workflow that posts a fixed approval request to `#approvals`, waits on a hook, and updates the Slack message with the decision.
- `workflows/approval-request.ts`: one workflow-level helper that creates the hook with a random token, posts to Slack, waits with a timeout, and returns the decision. The tools reuse it.
- `workflows/chat.ts` and `workflows/agent-tools.ts`: a multi-turn `DurableAgent` conversation with five tools, serialized writes and wallet-owned facts.
- `app/api/chat/route.ts`: starts a conversation or resumes one with a follow-up message, and returns the per-turn UI stream.
- `app/chat/page.tsx`: the minimal chat UI with a demo customer selector; `/` keeps the Stage 1 approval demo.
- `app/api/approval/route.ts`: starts a run and returns its `runId` immediately.
- `app/api/approval/[runId]/route.ts`: returns the run status and result for polling.
- `app/api/slack/interactions/route.ts`: verifies Slack's HMAC signature, checks the clicker against `SLACK_APPROVER_IDS`, and resumes the hook.
- `app/page.tsx`: **Request approval** button plus the waiting, approved, rejected, timed-out, and error states.
- `workflows/hello.ts` and `app/api/hello/route.ts`: the original one-step smoke test.
- `lib/model.ts`: the single place where the model is chosen. Primary: Groq `openai/gpt-oss-120b` with low reasoning; manual fallback: `gemini-3.6-flash`.
- `data/customers.json` and `lib/wallet.ts`: three mock customers with balances, limits, locks and transactions. Amounts are integer cents; state mutations are pure and idempotent.
- `lib/policies.ts`: pure approval rules and the ownership check. The code rules are immutable; text rules can only add reasons.
- `instructions/agent.md`: the plain-text source of the agent behavior and the optional `rules` block.
- `lib/agent-rules.ts`: the deterministic parser, validator and compiler for text rules.
- `scripts/generate-agent-config.mts`: reads `agent.md`, fails the build on invalid rules, and writes the committed `lib/generated/agent-config.ts`.
- `workflows/transaction-claims.ts` and `workflows/claim-steps.ts`: cross-conversation claims for refunds and reversals (D26).
- `workflows/agent-tools.ts`: the five tools, the serialized per-conversation queue, and the claims.

## How the approval flow works

1. The page calls `POST /api/approval`.
2. The route starts `approvalWorkflow` and returns `{ runId }` without waiting.
3. A step generates an unguessable hook token; the workflow registers the hook, then posts a Block Kit message with **Approve** and **Reject** buttons to `#approvals`.
4. The workflow suspends on the hook for up to 10 minutes. No compute is used while it waits.
5. A click reaches `POST /api/slack/interactions`. The route verifies the signature, then checks the clicker's Slack user ID against `SLACK_APPROVER_IDS`. An authorized user resumes the hook with `{ approved, approver: { id, name }, decidedAt }`. Anyone else gets an ephemeral message only they can see, the attempt is logged with their user ID, and the hook keeps waiting for an authorized approver. If the variable is unset or empty, nobody can approve (fail closed) and the log names the variable.
6. The workflow updates the Slack message with who decided (name and Slack ID) and when, and removes the buttons. The hook payload and the run result store both. A second click is acknowledged but does nothing.
7. The page polls `GET /api/approval/[runId]` every 3 seconds and shows the outcome.

A request older than 5 minutes, or one with an invalid signature, is rejected with `401`. If nobody decides in time, the workflow ends as `timed_out`, the Slack message says so, and the hook is disposed so a late click cannot resume it. The timeout is `APPROVAL_TIMEOUT_MS` in `lib/approval-config.ts`.

## How the chat works

- `POST /api/chat` starts a conversation with `{ customerId, messages }` and returns a UI message stream plus `x-workflow-run-id`. Follow-ups send `{ runId, messages }`.
- One workflow owns the conversation: a chat hook with `token = runId` receives each message, and the workflow keeps the model history and the mock wallet state across turns.
- `DurableAgent` runs five tools: `lookup_account`, `refund_fee`, `reverse_transaction`, `raise_limit` and `unlock_account`. Tools receive IDs (and the new limit); amounts, recipient status, lock reason and the current limit come from the wallet.
- Ownership is a hard block: a transaction from another customer returns `refused`, never reaches Slack, and no approver can allow it. Write actions are serialized per conversation and applied in memoized steps.
- A refund or reversal on an account locked for suspected fraud always requires human approval. The rule only adds a reason; it never allows an action or blocks it. The model does not decide this; it calls the tool.
- If `recipientReceived` is missing, the reversal policy treats it as `true` (fail closed).
- The Slack approval message is built from code data. Customer-provided text is escaped and labeled `Customer says:`.
- `/api/chat` only resumes the chat-message hook. Approval hooks are resumed only by the signed Slack endpoint.
- `customerId` is accepted only when a conversation starts; follow-ups ignore it.
- A `429` is caught and written to the stream as a friendly assistant message.
- `/api/chat` returns `409` with a clear message when the conversation ended or the `runId` is not an active chat.
- Send `/done` to end a conversation. There is no GET reconnection route: a stream cut by the 300-second function limit is not resumed in the browser, but the workflow keeps running.

## Mock wallet and approval rules

`data/customers.json` has three customers:

| Customer | Cases |
|---|---|
| Ana Torres | `suspected_fraud` lock; fees of USD 12 and USD 45; transfers of USD 250 (not received), USD 60 (already received) and USD 80 (not received) |
| Bruno Silva | `lost_card` lock (unlock allowed); limit USD 1,000 |
| Diego Torres | Ana's husband, own account; Ana's transactions are foreign to him |

Amounts are stored as integer cents. `lib/wallet.ts` finds accounts and transactions and applies pure, idempotent mutations: a second refund or reversal is refused. The tools read amounts, recipient status, lock reason and the current limit from the wallet before evaluating rules; the model cannot send those facts. `lib/policies.ts` decides approval in code (never in a prompt):

- fee refund above USD 20;
- reversal above USD 100, or when the recipient already received the funds;
- new limit above 2x the current limit;
- unlock when the lock reason is suspected fraud;
- refund or reversal when the account is locked for suspected fraud (an additive code rule).

`raise_limit` also rejects non-positive limits and limits that do not exceed the current one, with a clear `WalletError`.

Any action on an account or transaction that does not belong to the session customer is a hard block: it never reaches Slack and no approver can allow it. `extraRules` is now wired: the text rules compile to extra rules that can add reasons, never remove the code rules.

## Plain-text instructions and rules

`instructions/agent.md` is the source of truth for behavior: identity, facts, tool-result states, the scenarios (refunds, reversals, limit increases, unlocks, ambiguous requests, out of scope, social engineering) and tone. Edit it, then run `npm run generate:agent` (or restart `npm run dev`, which runs it automatically). The generated `lib/generated/agent-config.ts` is committed so a fresh clone type-checks; do not edit it by hand.

The optional fenced `rules` block at the end of the file is read by code, not by the model. The reduced grammar is:

```
rule <tool> when <fact> is <literal> reason "<label>"
rule <tool> when <fact> > <number> reason "<label>"
```

- Tools: `refund_fee`, `reverse_transaction`, `raise_limit`, `unlock_account`.
- Facts: `account.locked`, `account.lock_reason`, `amount_usd`, `recipient_received`, `current_limit_usd`, `new_limit_usd` (each only on tools where it exists).
- No `and`, `or`, negation, arithmetic or allow rules. Two conditions are two rules; evaluation is OR, so text can only add approvals.
- An invalid line fails the build with `instructions/agent.md:<line>: <message>`; at runtime the route returns `500` and the workflow throws a `FatalError`. A rule is never silently ignored. A missing `rules` block is valid (zero extra rules).

Demo: the active line is `rule raise_limit when account.locked is true reason "Raising the limit on a locked account"`. With it, Ana's USD 500 → 700 request opens a Slack approval. Comment it out, regenerate, and the same request completes without approval. `request_human_input` (a Slack reply for ambiguous requests) is still future work; for now the agent asks one clarifying question and does not move money.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

The dev and build scripts regenerate the agent config first. To edit the instructions while the server is running, run `npm run generate:agent` and restart the workflow/dev server.

Open <http://localhost:3000/chat> for the agent chat, or <http://localhost:3000> for the Stage 1 approval demo.

Locally, the bot can post to `#approvals`, but a real Slack click cannot reach your Mac: Slack needs a public HTTPS URL. To exercise the full click-to-resume loop, deploy to Vercel (Stage 1) and set the interactivity URL below.

Verify the API without a browser:

```bash
curl -X POST http://localhost:3000/api/approval
# {"runId":"wrun_..."}

curl http://localhost:3000/api/approval/<runId>
# {"status":"running"}
```

Inspect workflow runs and steps:

```bash
npx workflow web
# or, in the terminal:
npx workflow inspect runs
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values. Set the same six in the Vercel project (Settings → Environment Variables) and **redeploy**: Vercel does not inject new values into an existing deployment, so a running deployment keeps the old environment until the next one.

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token with `chat:write` |
| `SLACK_SIGNING_SECRET` | Verifies that requests come from Slack |
| `SLACK_APPROVALS_CHANNEL_ID` | Channel that receives approval requests |
| `SLACK_APPROVER_IDS` | Comma-separated Slack user IDs allowed to approve. Unset or empty means nobody can approve (fail closed) |
| `GROQ_API_KEY` | Groq API key for the primary model (free tier: 8k tokens/minute) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio key for the Gemini fallback |

The primary model is Groq `openai/gpt-oss-120b` with reasoning effort low. On the same tool-call prompt it measured 543 ms and called `reverse_transaction` with the right arguments; `gemini-3.6-flash` measured 27.1 s on the same test and remains the **manual** fallback: an operator changes `PROVIDER` in `lib/model.ts`; there is no automatic failover. The Groq free tier allows 8,000 tokens per minute, so keep prompts short and reasoning low. Rate limits are caught and shown as a friendly message instead of a raw error.

To get a member ID, open the person's profile in Slack and choose **More → Copy member ID**. Example: `SLACK_APPROVER_IDS=U012AB3CDEF,U045GH6IJKL`.

`.env.local` is git-ignored. `.env.example` is committed and contains no secrets.

## Slack app setup

1. Create a Slack app and install it in the workspace.
2. Bot scopes: `chat:write`. Invite the bot to `#approvals`.
3. Keep **Socket Mode off**. With Socket Mode on, Slack replaces the Request URL field under Interactivity with an app-level token field. With Socket Mode off, enable Interactivity and set the Request URL to `https://plaude-agent.vercel.app/api/slack/interactions` — deploy first, so the URL exists.
4. Copy the bot token and the signing secret into `.env.local` and into the Vercel project's environment variables.
5. Collect the Slack user IDs of the people allowed to approve (profile → **More → Copy member ID**) and put them in `SLACK_APPROVER_IDS`, comma-separated, in both places. Redeploy Vercel after any environment change.

## Project layout

```
app/                 Pages and Route Handlers (chat UI at /chat)
data/                Mock wallet customers and transactions
instructions/        Plain-text agent behavior and the text rule block
lib/                 Model, wallet, policies, rule parser, generated config, Slack helpers and types
scripts/             Build-time agent-config generator
workflows/           Workflow functions, tools, claims and their steps
DECISIONS.md         Architecture decisions, one entry per choice
CLAUDE.md            Project instructions for the coding agent
```

Next steps: the designed UI with the operator timeline (Stage 4) and tests (Stage 5). As a next safety step, put a prompt-injection filter (for example `meta-llama/llama-prompt-guard-2-86m`, available on Groq) in front of the agent. Deferred from Stage 2 and documented in DECISIONS: `request_human_input` with a Slack modal, and reconnecting to a workflow stream that was cut by the 300-second function limit.

## Notes

- Mock data only. According to Groq's API policy, Groq does not train on API data. If the manual fallback is switched to Gemini, Google AI Studio's free tier may use prompts to improve its products. Never put real customer data in.
- The free tiers have variable latency and rate limits. `lib/model.ts` is the only place to change the model; switching between Groq and Gemini is one constant. Gemini is a manual standby, not an automatic failover.
- The brief asks for `DurableAgent`; Vercel's newer `WorkflowAgent` (`@ai-sdk/workflow`) is a possible future migration, recorded in [DECISIONS.md](./DECISIONS.md).
- Cross-conversation claims (D26) prevent applying the same refund or reversal twice. They do not share balances between conversations: two *different* actions on one account still mutate two per-run clones. Real balances need a shared store (Stage 4+). A run cancelled in the narrow window between a mutation and its done marker could allow a retry; steps replay, so this is a terminal-cancellation edge case.
- The system prompt is not stored in the conversation history (D25). On a five-turn test, turn 5 input went from 2,448 tokens to 993 and the AI SDK prompt-injection warning disappeared.
