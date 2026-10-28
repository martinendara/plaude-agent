# Plaude Agent

Customer support agent for Acme Wallet (a mock digital wallet), built for the Plaude engineering challenge.

**Current stage:** Stage 1, first slice — a Next.js app with Workflow DevKit running locally. No Slack and no AI yet.

## What exists now

- Next.js 16 (App Router, TypeScript strict, Tailwind CSS 4) in `app/`.
- Workflow DevKit configured with `withWorkflow()` in `next.config.ts`.
- `workflows/hello.ts`: one workflow with one step that returns `"hello"`.
- `app/api/hello/route.ts`: `POST` endpoint that starts the workflow and waits for its result.
- `app/page.tsx`: button that triggers the endpoint and shows the message or an error.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and press **Run workflow**.

Verify without a browser:

```bash
curl -X POST http://localhost:3000/api/hello
# {"runId":"...","message":"hello"}
```

Inspect workflow runs and steps:

```bash
npx workflow web
# or, in the terminal:
npx workflow inspect runs
```

## Environment variables

None yet. Slack and Gemini credentials arrive in later stages and will live in `.env.local` (git-ignored) and in Vercel environment variables.

## Project layout

```
app/                 Next.js App Router (page + API route)
workflows/           Workflow functions and their steps
DECISIONS.md         Architecture decisions, one entry per choice
CLAUDE.md            Project instructions for the coding agent
```

Later stages add `lib/` (model selection), `instructions/` (plain-text agent instructions), and `data/` (mock wallet data).

## Notes

- Mock data only. When Gemini is wired, prompts go to the Google AI Studio free tier, which may use them to improve its products — never put real customer data in.
- The brief asks for `DurableAgent`; Vercel's newer `WorkflowAgent` (`@ai-sdk/workflow`) is a possible future migration, recorded in [DECISIONS.md](./DECISIONS.md).
