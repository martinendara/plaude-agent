# Decisions

Architecture decisions for the Plaude engineering challenge, in the order they were made. Each entry follows the same shape: context, decision, alternatives, consequences. Written in plain language so every choice can be defended.

## D1. Next.js 16 with the App Router

**Context.** The brief requires a Next.js UI and a public URL for Slack callbacks. The app needs pages, server endpoints for starting workflows and receiving Slack events, and a zero-cost deploy on Vercel Hobby.

**Decision.** Next.js 16.4 with the App Router (`app/`), TypeScript in strict mode, the `@/*` import alias, and npm as the package manager. Scaffolded with `create-next-app` using `--empty` (no demo content) and `--disable-git` (we make our own first commit).

**Alternatives considered.**
- Pages Router: older model; Route Handlers, layouts, and streaming are first-class in the App Router, which current Next.js docs teach first.
- Vite + React with a separate Express server: two deployables and more moving parts, with no zero-config Vercel deploy.
- Remix or SvelteKit: viable, but the brief and the ecosystem docs here are Next.js-first.

**Consequences.**
- Route Handlers live in `app/api/*/route.ts` and use the Web `Request`/`Response` APIs.
- Next 16 enables `cacheComponents` in the generated config; `POST` handlers are never cached, so the workflow trigger needs no extra cache directive.
- Next 16 ships an `AGENTS.md` telling coding agents to read the bundled docs in `node_modules/next/dist/docs` before writing code. We follow it.
- Strict TypeScript catches serialization and return-type mistakes at build time.

## D2. Tailwind CSS 4

**Context.** The UI is part of the grade: the brief asks for a coherent design system, light and dark themes, mobile width, and accessibility. We need spacing, typography, and states quickly without maintaining a parallel CSS codebase.

**Decision.** Tailwind CSS 4, as installed by `create-next-app` (`tailwindcss` and `@tailwindcss/turbopack`, imported in `app/globals.css` with `@import "tailwindcss"`).

**Alternatives considered.**
- CSS Modules or plain CSS: no build-time utility layer, more naming and dead-CSS work; slower for the operator timeline in Stage 4.
- A component library (shadcn/ui, MUI, Chakra): extra dependencies and opinions; the design direction is Martín's, not a library's.
- Tailwind 3: v4 is the current version and the one `create-next-app` installs.

**Consequences.**
- No runtime JavaScript: Tailwind compiles to CSS during the build.
- `dark:` variants follow the operating system preference by default; there is no theme toggle yet.
- Design tokens live in utility classes for now. If Stage 4 needs a custom scale, the place to add it is `app/globals.css` with `@theme`.

## D3. Workflow DevKit (`workflow` v5) with `withWorkflow`

**Context.** The brief requires the agent to pause for a human in Slack, survive restarts, and resume later without consuming compute. Next.js alone can run an async request, but it cannot persist a pause for hours or replay a run after a deploy or a crash. That durability is the core of the product.

**Decision.** Install the official `workflow` package (5.2.3) and wrap `next.config.ts` with `withWorkflow()` from `workflow/next`. Workflows live in `workflows/` and use the `"use workflow"` directive; side effects live in steps marked `"use step"`. Server code starts a run with `start()` from `workflow/api`. Added the optional `workflow` TypeScript plugin to `tsconfig.json` for editor hints.

**What it does and what it weighs.** Durable functions for TypeScript: an event log persists every step result, and a run can suspend and resume across failures and deploys. It is server-only and adds 380 packages to the dependency tree (npm reported 23 high-severity advisories after install; those need a review, not a blind `audit fix --force`). Nothing from `workflow` ships to the browser: it is imported only in `next.config.ts`, `workflows/`, and Route Handlers.

**Alternatives considered.**
- Plain Next.js async code: no durable pause. A Slack approval that arrives ten minutes later has no live process to resume, and a redeploy loses in-memory state.
- Temporal: the reference for durable execution, but it needs a server or cluster and is not free-tier friendly on Hobby.
- Inngest or Trigger.dev: hosted durable workflows with free tiers, but the brief explicitly asks for Workflow DevKit, and the SDK keeps the logic in-repo without a vendor SDK lock-in.
- Vercel `WorkflowAgent` (`@ai-sdk/workflow`): the newer agent abstraction. The brief asks for `DurableAgent`; migration is noted as future work.

**Consequences.**
- The workflow function must be deterministic. It orchestrates; it must not do I/O directly. All I/O goes in steps. This constraint is what makes replay safe, and it shapes the Stage 2 agent design.
- Arguments and return values are serialized by value. They must be serializable; mutations across the boundary are not shared.
- The local world is automatic in development. `npx workflow web` and `npx workflow inspect runs` show runs and steps. Generated routes live under `.well-known/workflow` and must be excluded from any future proxy or middleware matcher.
- A missing `"use workflow"` directive or a missing `withWorkflow()` fails at `start()` with "invalid workflow function", documented in the SDK's troubleshooting section.
- The package is the only production dependency added beyond the scaffold. It is required by the brief, so it is not a discretionary dependency.

## D4. Triggering via a POST Route Handler and `start()`

**Context.** The page needs a button that runs the workflow and shows the result. The SDK can be triggered from Route Handlers, Server Actions, or any server code.

**Decision.** `app/api/hello/route.ts` exposes `POST`, calls `start(helloWorkflow)`, awaits `run.returnValue`, and returns `{ runId, message }` as JSON. The page is a Client Component that calls this endpoint.

**Alternatives considered.**
- Server Action: fewer moving parts, but the demo needs an HTTP shape that `curl` can hit and that later stages can reuse.
- Server-rendered result without a client fetch: less representative of the eventual chat UI, which must handle pending and error states on the client.
- Streaming the run to the client: unnecessary for a one-step workflow. Stage 4 will need a richer pattern for the run timeline; `start()` plus `returnValue` is the documented minimal path.

**Consequences.**
- The endpoint blocks until the workflow finishes. That is fine for a one-step hello. For long approvals in Stage 2 the endpoint must not hold the HTTP request open; it should return a run ID and let the UI follow the run.
- Errors surface as non-2xx responses, and the page shows a clear error state with the status code.
- The result is a string today, typed end to end: `run.returnValue` infers the workflow's return type.

## D5. Slack Web API with `fetch`, not Bolt

**Context.** The approval flow needs to post a Block Kit message, update that same message later, and receive button clicks. Slack offers several ways to do this.

**Decision.** Call the Slack Web API directly (`chat.postMessage`, `chat.update`) with `fetch`. No Slack library. Handlers use the Web `Request`/`Response` APIs.

**Alternatives considered.**
- `@slack/bolt`: brings a full app framework and a long-running HTTP receiver; on serverless it needs an adapter, and it is a new dependency for three HTTP calls.
- `@slack/web-api`: a thin wrapper that still adds a dependency and types we would not use everywhere.
- Incoming webhooks: can only post, cannot update a message or receive interactions.
- Slack SDK for JS in general: the same HTTP calls, plus maintenance and bundle weight.

**Consequences.**
- We own error handling and the request shapes. Slack API errors are surfaced as `FatalError` in steps, so they are not retried blindly.
- No dependency added: the integration is server-only, used in `workflows/approval-steps.ts` and `app/api/slack/interactions/route.ts`.
- Block Kit payloads are built in `lib/slack-blocks.ts` and can be inspected and tested as plain data.

## D6. Verify Slack's HMAC signature, not the legacy Verification Token

**Context.** The interactions endpoint is public. Anyone who finds it could resume a hook. Slack signs every request with the app's signing secret. The older Verification Token is a static shared value that never changes per request and can be replayed.

**Decision.** On every request: read the raw body, take `X-Slack-Request-Timestamp` and `X-Slack-Signature`, reject timestamps older than 5 minutes, compute `HMAC-SHA256("v0:" + timestamp + ":" + rawBody)` with `SLACK_SIGNING_SECRET`, and compare with `crypto.timingSafeEqual`. Any failure returns `401`. Node's built-in `node:crypto` is enough.

**Alternatives considered.**
- Verification Token: deprecated, replayable, and not bound to the request body.
- No verification: the endpoint would let anyone resume approvals.
- IP allowlist: Slack's addresses change and this is not authentication.
- A signing library: unnecessary; the algorithm is four lines.

**Consequences.**
- The body must be read as text **before** parsing; parsing first would change the bytes and break the HMAC.
- Constant-time comparison avoids leaking how much of a forged signature matched.
- Requests older than five minutes fail even with a correct signature, which limits replay.
- The route only accepts Slack's form-encoded `payload` field, not JSON.

## D7. Return a `runId` and poll, instead of holding the request open

**Context.** An approval can wait minutes. Vercel Functions have a 300-second maximum duration, and holding a request open while a human thinks wastes compute and fails at the limit. The page also needs to show progress.

**Decision.** `POST /api/approval` starts the run and returns `{ runId }` immediately. `GET /api/approval/[runId]` reads `run.status` and, when completed, `run.returnValue`. The page polls that endpoint every 3 seconds and stops at a terminal status.

**Alternatives considered.**
- `await run.returnValue` inside the POST: blocks the request, hits the 300-second limit, and loses the result on timeout.
- Server-Sent Events or WebSockets: more moving parts and connection management for a spike; a better fit for the Stage 4 timeline.
- A push from the workflow to the browser: there is no browser connection to push to; it would still need a polling or streaming channel.

**Consequences.**
- One extra endpoint and a small amount of polling traffic (every 3 seconds, only while a run is open).
- Refreshing the page loses the `runId` for now; persisting it in the URL is a Stage 4 improvement.
- The run keeps its state regardless of the page; closing the tab does not cancel the approval.
- Stage 4 can replace polling with Workflow streaming without changing the workflow.

## D8. Timeout a hook with a durable `sleep`

**Context.** Without a deadline, an approval could stay open forever and the Slack message would keep live buttons. The brief asks for a configurable timeout.

**Decision.** Race the hook against `sleep(APPROVAL_TIMEOUT_MS)` with `Promise.race`. The constant lives in `lib/approval-config.ts` (10 minutes for this test). On timeout the workflow updates the Slack message ("Timed out · no decision after N minutes"), removes the buttons, and returns `{ status: "timed_out" }`.

**Alternatives considered.**
- No timeout: stale approvals and buttons that still look actionable.
- A cron job that sweeps old approvals: extra infrastructure and a second source of truth.
- Relying only on hook TTL: the workflow would not know the outcome and the Slack message would stay ambiguous.

**Consequences.**
- The losing branch is not cancelled: `Promise.race` leaves the hook pending until the run ends. That is fine because the hook has no side effects.
- A click after the timeout finds no active hook (`HookNotFoundError`); the interactions route acknowledges it with `200` and does nothing.
- The timeout is visible both in the page and in the Slack message, and the run log records the deadline.

## D9. Generate the hook token in a step, and register the hook before posting

**Context.** Tokens generated inside a workflow come from the run's deterministic seed: they are hard to guess but not secret. Custom tokens built from business data are easy to reconstruct. Also, `createHook()` does not register the hook until the workflow suspends, so posting the token before registration can make an immediate click fail with `HookNotFoundError`.

**Decision.** Generate a UUID in a step, where the platform's cryptographic randomness is available, and pass it as `token` to `createHook()`. Await `hook.getConflict()` to commit registration **before** the Slack message exposes the token. The token travels only in the button `value`. The signing secret, not the token, authenticates the click.

**Alternatives considered.**
- Let `createHook()` generate the token inside the workflow: deterministic from the run seed, so treat it as an unlisted link, not a credential.
- Use a token derived from the request or order ID: convenient routing, but anyone who knows the ID can compute it.
- Use a `createWebhook()` URL in Slack: the URL token would be the only authorization, exactly what the brief prohibits.

**Consequences.**
- One extra step and one extra suspension per run, which is negligible compared with a human decision.
- The token is visible to members of `#approvals`; it is not a secret. Authorization is the Slack signature plus the channel's access control.
- If a token ever collided, `getConflict()` returns the owning run and the workflow fails instead of hijacking another approval.
