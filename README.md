# Plaude Agent

Customer support agent for Acme Wallet (a mock digital wallet), built for the Plaude engineering challenge.

**Current stage:** Stage 1 — a durable Slack approval flow, still without AI.

## What exists now

- Next.js 16 (App Router, TypeScript strict, Tailwind CSS 4) in `app/`.
- Workflow DevKit configured with `withWorkflow()` in `next.config.ts`.
- `workflows/approval.ts`: a durable workflow that posts a fixed approval request to `#approvals`, waits on a hook, and updates the Slack message with the decision.
- `app/api/approval/route.ts`: starts a run and returns its `runId` immediately.
- `app/api/approval/[runId]/route.ts`: returns the run status and result for polling.
- `app/api/slack/interactions/route.ts`: verifies Slack's HMAC signature, checks the clicker against `SLACK_APPROVER_IDS`, and resumes the hook.
- `app/page.tsx`: **Request approval** button plus the waiting, approved, rejected, timed-out, and error states.
- `workflows/hello.ts` and `app/api/hello/route.ts`: the original one-step smoke test.

## How the approval flow works

1. The page calls `POST /api/approval`.
2. The route starts `approvalWorkflow` and returns `{ runId }` without waiting.
3. A step generates an unguessable hook token; the workflow registers the hook, then posts a Block Kit message with **Approve** and **Reject** buttons to `#approvals`.
4. The workflow suspends on the hook for up to 10 minutes. No compute is used while it waits.
5. A click reaches `POST /api/slack/interactions`. The route verifies the signature, then checks the clicker's Slack user ID against `SLACK_APPROVER_IDS`. An authorized user resumes the hook with `{ approved, approver, decidedAt }`. Anyone else gets an ephemeral message only they can see, the attempt is logged with their user ID, and the hook keeps waiting for an authorized approver. If the variable is unset or empty, nobody can approve (fail closed) and the log names the variable.
6. The workflow updates the Slack message with who decided and when, and removes the buttons. A second click is acknowledged but does nothing.
7. The page polls `GET /api/approval/[runId]` every 3 seconds and shows the outcome.

A request older than 5 minutes, or one with an invalid signature, is rejected with `401`. If nobody decides in time, the workflow ends as `timed_out` and the Slack message says so. The timeout is `APPROVAL_TIMEOUT_MS` in `lib/approval-config.ts`.

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

Copy `.env.example` to `.env.local` and fill in the values. Set the same four in the Vercel project (Settings → Environment Variables) and **redeploy**: Vercel does not inject new values into an existing deployment, so a running deployment keeps the old environment until the next one.

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token with `chat:write` |
| `SLACK_SIGNING_SECRET` | Verifies that requests come from Slack |
| `SLACK_APPROVALS_CHANNEL_ID` | Channel that receives approval requests |
| `SLACK_APPROVER_IDS` | Comma-separated Slack user IDs allowed to approve. Unset or empty means nobody can approve (fail closed) |

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
lib/                 Shared types, Block Kit builders, signature verification
workflows/           Workflow functions and their steps
DECISIONS.md         Architecture decisions, one entry per choice
CLAUDE.md            Project instructions for the coding agent
```

Later stages add `instructions/` (plain-text agent instructions) and `data/` (mock wallet data).

## Notes

- Mock data only. When Gemini is wired, prompts go to the Google AI Studio free tier, which may use them to improve its products — never put real customer data in.
- The brief asks for `DurableAgent`; Vercel's newer `WorkflowAgent` (`@ai-sdk/workflow`) is a possible future migration, recorded in [DECISIONS.md](./DECISIONS.md).
