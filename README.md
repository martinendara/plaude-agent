# Plaude Agent

Customer support agent for Acme Wallet (a mock digital wallet), built for the Plaude engineering challenge.

**Current stage:** Stage 2 in progress — the agent foundations plus a reusable approval helper. The tools and the chat UI come in the next checkpoints.

## What exists now

- Next.js 16 (App Router, TypeScript strict, Tailwind CSS 4) in `app/`.
- Workflow DevKit configured with `withWorkflow()` in `next.config.ts`.
- `workflows/approval.ts`: a durable workflow that posts a fixed approval request to `#approvals`, waits on a hook, and updates the Slack message with the decision.
- `workflows/approval-request.ts`: one workflow-level helper that creates the hook with a random token, posts to Slack, waits with a timeout, and returns the decision. It is the single path Stage 2 tools will reuse.
- `app/api/approval/route.ts`: starts a run and returns its `runId` immediately.
- `app/api/approval/[runId]/route.ts`: returns the run status and result for polling.
- `app/api/slack/interactions/route.ts`: verifies Slack's HMAC signature, checks the clicker against `SLACK_APPROVER_IDS`, and resumes the hook.
- `app/page.tsx`: **Request approval** button plus the waiting, approved, rejected, timed-out, and error states.
- `workflows/hello.ts` and `app/api/hello/route.ts`: the original one-step smoke test.
- `lib/model.ts`: the single place where the model is chosen (`gemini-3.6-flash` through `@ai-sdk/google`).
- `data/customers.json` and `lib/wallet.ts`: three mock customers with balances, limits, locks and transactions. Amounts are integer cents; state mutations are pure and idempotent.
- `lib/policies.ts`: pure approval rules and the ownership check. The rules live in code; plain text (Stage 3) can only add reasons.

## How the approval flow works

1. The page calls `POST /api/approval`.
2. The route starts `approvalWorkflow` and returns `{ runId }` without waiting.
3. A step generates an unguessable hook token; the workflow registers the hook, then posts a Block Kit message with **Approve** and **Reject** buttons to `#approvals`.
4. The workflow suspends on the hook for up to 10 minutes. No compute is used while it waits.
5. A click reaches `POST /api/slack/interactions`. The route verifies the signature, then checks the clicker's Slack user ID against `SLACK_APPROVER_IDS`. An authorized user resumes the hook with `{ approved, approver: { id, name }, decidedAt }`. Anyone else gets an ephemeral message only they can see, the attempt is logged with their user ID, and the hook keeps waiting for an authorized approver. If the variable is unset or empty, nobody can approve (fail closed) and the log names the variable.
6. The workflow updates the Slack message with who decided (name and Slack ID) and when, and removes the buttons. The hook payload and the run result store both. A second click is acknowledged but does nothing.
7. The page polls `GET /api/approval/[runId]` every 3 seconds and shows the outcome.

A request older than 5 minutes, or one with an invalid signature, is rejected with `401`. If nobody decides in time, the workflow ends as `timed_out`, the Slack message says so, and the hook is disposed so a late click cannot resume it. The timeout is `APPROVAL_TIMEOUT_MS` in `lib/approval-config.ts`.

## Mock wallet and approval rules

`data/customers.json` has three customers:

| Customer | Cases |
|---|---|
| Ana Torres | `suspected_fraud` lock; fees of USD 12 and USD 45; transfers of USD 250 (not received), USD 60 (already received) and USD 80 (not received) |
| Bruno Silva | `lost_card` lock (unlock allowed); limit USD 1,000 |
| Diego Torres | Ana's husband, own account; Ana's transactions are foreign to him |

Amounts are stored as integer cents. `lib/wallet.ts` finds accounts and transactions and applies pure, idempotent mutations: a second refund or reversal is refused. `lib/policies.ts` decides approval in code (never in a prompt):

- fee refund above USD 20;
- reversal above USD 100, or when the recipient already received the funds;
- new limit above 2x the current limit;
- unlock when the lock reason is suspected fraud.

`raise_limit` also rejects non-positive limits and limits that do not exceed the current one, with a clear `WalletError`.

Any action on an account or transaction that does not belong to the session customer is a hard block: it never reaches Slack and no approver can allow it. `extraRules` is the Stage 3 extension point: text rules can add reasons, never remove the code rules.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and press **Request approval**.

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

Copy `.env.example` to `.env.local` and fill in the values. Set the same five in the Vercel project (Settings → Environment Variables) and **redeploy**: Vercel does not inject new values into an existing deployment, so a running deployment keeps the old environment until the next one.

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token with `chat:write` |
| `SLACK_SIGNING_SECRET` | Verifies that requests come from Slack |
| `SLACK_APPROVALS_CHANNEL_ID` | Channel that receives approval requests |
| `SLACK_APPROVER_IDS` | Comma-separated Slack user IDs allowed to approve. Unset or empty means nobody can approve (fail closed) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio key for the Gemini Flash model |

The Google key is read by `@ai-sdk/google` from `GOOGLE_GENERATIVE_AI_API_KEY`. On the free tier, a short direct call to `gemini-3.6-flash` measured 26–33 s end to end and 27 s to the first streamed token; a full DurableAgent workflow measured about 54 s. `gemini-3.5-flash-lite` measured about 18 s. The tier can also return `429` under load; the app catches it and answers with a friendly message instead of a raw error.

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
app/                 Pages and Route Handlers
data/                Mock wallet customers and transactions
lib/                 Model, wallet, policies, money, Slack helpers and types
workflows/           Workflow functions and their steps
DECISIONS.md         Architecture decisions, one entry per choice
CLAUDE.md            Project instructions for the coding agent
```

Next steps: the tool layer and conversation workflow, the minimal chat UI, then `instructions/` (Stage 3) and the designed UI with the operator timeline (Stage 4). Deferred from Stage 2 and documented in DECISIONS: `request_human_input` with a Slack modal, and reconnecting to a workflow stream that was cut by the 300-second function limit.

## Notes

- Mock data only. Prompts go to the Google AI Studio free tier, which may use them to improve its products — never put real customer data in.
- The free tier has variable latency and rate limits. `lib/model.ts` is the only place to change the model; swapping providers is one line.
- The brief asks for `DurableAgent`; Vercel's newer `WorkflowAgent` (`@ai-sdk/workflow`) is a possible future migration, recorded in [DECISIONS.md](./DECISIONS.md).
