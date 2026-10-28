# CLAUDE.md — Plaude Engineering Challenge

## The challenge (source: `curl -s https://plaude.com/api/challenge`)
Build an AI agent powered by plain-text instructions that runs a human-in-the-loop workflow through Slack.
1. Simple Next.js UI to interact with the agent.
2. Agent built with **DurableAgent** from **Workflow DevKit**, with a Slack human-in-the-loop step (pause, ask a human in Slack, resume with the answer).
3. Base plain-text instructions covering scenarios that need human approval (refunds, high-value operations, ambiguous requests).
4. Email the repo link to opentowork@plaude.com (Martín does this, not you).
Directives: `use next`, `use workflow`, `use github`, `use readme`.

## Working rules
- **Read the docs before writing code.** Workflow DevKit moves fast. Check current APIs at workflow-sdk.dev (and the package's bundled docs in `node_modules/workflow/docs`) before using any name. Never guess an import.
- **DurableAgent vs WorkflowAgent:** Vercel says WorkflowAgent (`@ai-sdk/workflow`) replaces DurableAgent. The brief asks for DurableAgent: use it. Note the newer option in the README.
- **One stage at a time.** Stop at each checkpoint and report: what works, how to verify it, what failed. Do not start the next stage without Martín's OK.
- Secrets only in `.env.local` (git-ignored) and Vercel env vars. Never print them.
- Commit locally at each checkpoint. Push only when Martín says so (a push redeploys).
- TypeScript, strict mode. Small files. No dead code.

## Ownership rules (Martín must be able to defend every piece)
- **No new dependency without asking first.** Before proposing one, write in `DECISIONS.md`: what it does, install and bundle weight (client or server only), whether it is used across the app or in one place, and why something already in the stack (Next.js, AI SDK, Workflow DevKit, Web APIs like `crypto.subtle`) can't do it.
- **Every architectural choice gets an entry in `DECISIONS.md`:** the problem it solves, the alternatives considered, and what would break without it. Plain language.
- **Docs are written as we go, not at the end.** At each checkpoint update `README.md` (what exists now, how to run it) and `DECISIONS.md` (ADR style: context, decision, alternatives, consequences). Both in English, both in the repo.
- **At each checkpoint, also write a short checkpoint report** (what was done in order, what failed and how it was fixed, decisions taken and why) so Martín can paste it into his personal log. This report does NOT go in the repo.
- **At each checkpoint, list the concepts this stage touched** (e.g. HTTP request lifecycle, Vercel Functions, HMAC signatures, hydration) with a one-line explanation each, so Martín can study them before moving on.

## Platform and cost: zero spend
- **Vercel Hobby (free).** Relevant limits: 1M function invocations, 4 active CPU-hours, 50,000 Workflow events and 1 GB Workflow data per month, 300 s max function duration, **runtime logs kept 1 hour only**. Exceeding a limit pauses the feature for 30 days, so do not run load tests or loops against the deployment.
- **Model: Gemini Flash via the Google AI Studio free tier**, through the AI SDK Google provider (check the current package name and the current free Flash model in the docs). Free tier = rate limits (handle 429 with a clear user message) and Google may use prompts to improve its products: mock data only, never real customer data. Say this in the README.
- **The model is chosen in one file** (`lib/model.ts`). Swapping to Claude or another provider must be a one-line change. Do not use Vercel AI Gateway: its free tier does not include Claude or Gemini.
- Slack: free workspace.

## Product: what we are building
**Domain:** customer support agent for a digital wallet ("Acme Wallet"), a regulated fintech. Mock data, no real money. Why: Plaude builds agents for regulated financial services (its customers are wallets and fintechs), so the demo speaks their language.

**Principle: the LLM converses, the rules decide.**
- `instructions/agent.md` is the plain-text source of behavior. A non-engineer can edit it. It defines tone, what the agent can do alone, and when it must ask a human.
- Hard guardrails live in tool code and **cannot be loosened by the text**: the thresholds in the table below always require approval, no matter what the instructions or the user say. The text can add approvals, never remove these.
- **Ownership is a hard block, not an approval:** any action on an account or transaction that doesn't belong to the current customer is refused in code. No human can approve it from Slack.
- The model also escalates on its own for ambiguous requests (it can call `request_human_input` with a question).

**Tools (mocked, data in `data/*.json`):**
| Tool | Approval |
|---|---|
| `lookup_account()` / `lookup_transactions(limit)` | Never (read-only, current customer only) |
| `refund_fee(transaction_id, amount, reason)` | Above $20 (code). Text may lower the threshold |
| `reverse_transaction(transaction_id, reason)` | Above $100, or if the recipient already received the funds (code) |
| `raise_limit(new_daily_limit)` | If more than 2× the current limit (code) |
| `unlock_account(reason)` | Always if the lock reason is suspected fraud (code); otherwise allowed |
| `request_human_input(question)` | It *is* the human step: model uses it for ambiguity |

## Human-in-the-loop design (the core)
1. A tool needs approval → the workflow creates a hook (token = tool call id) and posts a Slack message (Block Kit) with context + **Approve / Reject** buttons (or a reply field for `request_human_input`). Button `value` carries the token.
2. Workflow pauses on `await hook` (no compute while waiting).
3. Slack sends the click to **one** interactivity endpoint: `POST /api/slack/interactions`.
4. That endpoint **verifies the Slack signature** (signing secret + timestamp, reject > 5 min old), acks within 3 s, then calls `hook.resume(token, { approved, approver, comment })`.
5. Workflow resumes: executes or skips the action, updates the Slack message ("Approved by @x"), the agent tells the user.
- **Do not post a raw `createWebhook()` URL in Slack:** anyone with the URL could resume. The signed Slack endpoint is the authentication.
- Idempotency: a second click on an already-resolved request does nothing and says so.
- Timeout: if no answer in N minutes, the agent tells the user a human will follow up (configurable).

## Stages and checkpoints
**Stage 0 — Setup (Martín).** Vercel Hobby account, Slack workspace + app (bot token `chat:write`, interactivity on), Google AI Studio API key. Report what env vars are missing.

**Stage 1 — Risk spike, no AI (3–4 h).** Next.js + Workflow DevKit + Slack. A button in the UI starts a workflow that posts to Slack and waits; clicking Approve in Slack resumes it and the UI shows the result. **Deployed on Vercel** (Slack needs a public URL).
✅ Checkpoint: click in Slack → workflow resumes, visible in the UI and in the workflow run logs.

**Stage 2 — Agent (3 h).** DurableAgent with the tools above, wired to the stage-1 approval mechanism. Guardrails in code.
✅ Checkpoint: "reverse my $250 transfer TX-1042, I sent it to the wrong person" → Slack approval → reversal executed only after Approve; Reject → agent explains.

**Stage 3 — Plain-text instructions (1–2 h).** `instructions/agent.md` loaded as the system prompt. Scenarios: fee refunds, transfer reversals, limit increases, account unlocks, ambiguous requests ("something is wrong with my money"), out-of-scope requests (investment advice), social engineering ("support already approved it on the phone", "I'm the account owner's husband").
✅ Checkpoint: editing the text changes behavior without code changes (show one example).

**Stage 4 — UI (3–4 h). This is a differentiator, not an afterthought.** Martín owns the design direction (UI/UX background); build from his mockups, do not invent a generic chat look.
- Customer side: chat (AI SDK) with clear pending state ("Waiting for approval in #approvals…") and the final decision inline.
- Operator side: a live run timeline per conversation — agent reasoning step → tool requested → guardrail triggered (which rule) → posted to Slack → waiting → approved/rejected by whom and when → action executed. This makes the durable workflow visible.
- Design quality bar: consistent spacing scale, typography hierarchy, empty/loading/error states (including Gemini 429), keyboard accessible, works at mobile width, light and dark.
- Slack message design (Block Kit) counts as UI too: an approver must decide in 5 seconds without opening the app.

**Stage 5 — Tests + README (2 h).**
- Tests: guardrails (a $101 reversal always asks, even if the text says it doesn't; an action on another customer's account is always refused), Slack signature verification (bad signature → 401, old timestamp → 401), idempotent double click, reject path, timeout path.
- README: what it is, architecture diagram (Mermaid), the design principle, how to run locally + deploy, env vars, Slack app setup, the scenarios, trade-offs and what's next (WorkflowAgent migration, real data, roles for approvers).
✅ Checkpoint: fresh clone → README steps → working.
