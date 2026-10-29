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

## D10. Authorize approvers with a user-ID allowlist, and fail closed

**Context.** The HMAC check in D6 proves that a request comes from Slack; it does not prove who clicked. Any member of the workspace who can see `#approvals`, including a guest or a new teammate, could press **Approve** on a refund or a reversal. In a regulated wallet, an approval has to be attributable to specific people, not to whoever happens to be in the channel.

**Decision.** Read `SLACK_APPROVER_IDS`, a comma-separated list of Slack user IDs, on each click. Compare it with `payload.user.id` before calling `resumeHook`. If the clicker is not in the list:
- do not resume the hook, so a valid approver can still decide and the approval is not wasted;
- send the clicker an ephemeral message (`chat.postEphemeral`), visible only to them, explaining they are not authorized;
- log the attempt with their Slack user ID.

If `SLACK_APPROVER_IDS` is missing or empty, no one can approve and a `console.error` names the variable. The system **fails closed**: no list means no approvals, never "anyone may approve". The parsing and matching live in `lib/approvers.ts` as pure functions so Stage 5 can test them without HTTP.

**Alternatives considered.**
- Trust channel membership: anyone with workspace access can be invited to `#approvals`, and membership is not an approval role. There is no per-user record to defend.
- Slack user groups (`usergroups.users.*`): a real grouping primitive, but it needs the `usergroups:read` scope, an extra API call per click, and the group can be changed outside the repository without review.
- Store approvers in a database or an admin UI: the right end state for roles (noted as future work in the README), but there is no database in Stage 1 and it adds infrastructure before it is needed.
- Fail open when the list is missing: a forgotten environment variable would silently turn into "anyone can approve", which is the worst possible failure mode.
- Check on the bot side before posting: the bot posts the message, so there is no human identity to check until someone clicks.

**Consequences.**
- A deployment without `SLACK_APPROVER_IDS` blocks every approval by design. The error log names the variable, and the README explains how to obtain Slack member IDs.
- Slack user IDs are scoped to the workspace; moving to another workspace means updating the list.
- `chat.postEphemeral` needs only `chat:write`, which the bot already has, so no new scope or dependency.
- If the ephemeral message fails (for example, the bot cannot post in that channel), the attempt is still blocked and the failure is logged; the security decision never depends on the notification.
- Slack receives `200` for an unauthorized click (a Slack ack), and the clicker sees only the ephemeral message.
- Runtime logs last one hour on Hobby. The durable audit trail is the Stage 4 run timeline, not `console` output.
- Stage 5 adds tests: an unauthorized user must not resume the hook, and an empty list must block every approver.

## D11. Pin the AI SDK stack to the `ai@6` line that `DurableAgent` requires

**Context.** The brief requires `DurableAgent`. It is not part of `workflow@5.2.3`; it lives in the separate `@workflow/ai` package, which the Workflow docs mark as deprecated in favor of `WorkflowAgent`. `@workflow/ai@5.0.3` peers on `ai@^6` and depends on `@ai-sdk/provider@^3`, while the current `ai@7` and `@ai-sdk/google@4.x` use provider v4. The two lines cannot be mixed.

**Decision.** Install exact versions: `@workflow/ai@5.0.3`, `ai@6.0.317`, `@ai-sdk/google@3.0.139`, `@ai-sdk/react@3.0.320`, and declare `zod@4.6.7` (already in the tree). The model factory in `lib/model.ts` is marked `"use step"`: `DurableAgent` passes it into `doStreamStep` (a step), and a plain function fails step-argument serialization. A real spike confirmed the failure (“Cannot stringify a function”) and the fix.

**What each package does and what it weighs.**
- `@workflow/ai` (server only, used in `workflows/` and `lib/model.ts`): provides `DurableAgent` and the chat transport. It brings a nested copy of zod.
- `ai` (server only): required peer; types, `APICallError`, UI message chunks. About 8 MB unpacked.
- `@ai-sdk/google` (server only): Gemini provider, about 2.4 MB unpacked.
- `@ai-sdk/react` (client only, one page in Stage 2): `useChat`; adds `swr` and `throttleit`.
- `zod` (both): tool input schemas; already installed transitively, so declaring it adds no download.

**Alternatives considered.**
- `WorkflowAgent` from `@ai-sdk/workflow` with `ai@7`: the newer, supported path, but the brief explicitly asks for `DurableAgent`.
- Vercel AI Gateway: the string model form would be one line, but the rules forbid it and its free tier does not include Gemini.
- Unpinned `^` ranges: npm would resolve `ai@7` and break the agent silently on the next install.

**Consequences.**
- We are deliberately on a deprecated agent API. Migrating to `WorkflowAgent` later means changing the agent import, the model factory and the stream format; it stays as future work in the README.
- Exact pins make installs reproducible but require a manual upgrade.
- `npm audit` reports 24 high-severity advisories in the dependency tree. They need a review; `npm audit fix --force` is not used because it can change majors and break the pinned stack.
- No package from this list is imported into a client component except `@ai-sdk/react` in the future chat page.
- The `"use step"` factory leaks a Workflow-specific detail into the model file. It is documented there so a provider swap remains a one-line change.

## D12. Gemini 3.6 Flash through the Google AI Studio free tier

**Context.** The rules require one free model, chosen in a single file, with no AI Gateway. The Google provider reads its key from `GOOGLE_GENERATIVE_AI_API_KEY`. The free tier has variable latency and returns `429` under load.

**Decision.** `lib/model.ts` selects `gemini-3.6-flash` through `google()` from `@ai-sdk/google@3.0.139`. The Google provider exports `google` and `createGoogleGenerativeAI` in 3.x; the `createGoogle` alias only exists in 4.x. The model factory is a step (see D11).

**Alternatives considered.**
- `gemini-3.8-flash` (new stable): the free-tier call measured about 71 seconds for one short sentence in this project, versus 26–32 seconds for 3.6.
- `gemini-3.5-flash-lite`: faster (about 18 seconds) but a lighter model; kept as a one-line fallback.
- `gemini-2.5-flash`: free but access-limited to projects that used it in the past; not safe for a new demo.
- `gemini-flash-latest`: a hot-swapped alias, not reproducible.
- AI Gateway or a paid model: excluded by the zero-spend rule.

**Consequences.**
- Free-tier latency is visible: measured time to first token was 15–27 seconds, and it varies by load and project quota. The UI will stream tokens, but the first token can still take that long.
- Google may use free-tier prompts to improve its products; only mock data goes in.
- `thinkingLevel: "minimal"` is rejected by `gemini-3.6-flash`-era models with a 400 error, so no thinking override is sent. Lower levels did not improve latency in the measurements.
- A `429` is handled with a friendly message; the exact error is `APICallError` with `statusCode: 429`.
- Swapping model or provider stays a one-line change in `lib/model.ts`.

## D13. Mock wallet in integer cents, with pure policy rules and an OR-only extension point

**Context.** The guardrails cannot live in a prompt: a user or a later text instruction could talk the model out of them. Ownership is a hard block, not an approval. The demo has no database, and money must not be compared with floating point.

**Decision.**
- `data/customers.json` holds three mock customers that cover every rule: Ana (fraud lock; small and large fee refunds; reversal above the limit, reversal to a paid recipient, reversal below the limit; limit above 2x), Bruno (non-fraud lock; limit increase within 2x) and Diego (Ana's husband, whose own account cannot operate on Ana's transactions).
- Amounts are integer cents. `lib/money.ts` formats them as USD and converts tool input from dollars.
- `lib/wallet.ts` finds accounts and transactions and applies pure, idempotent reducers. A second refund or reversal is refused by transaction state, not by hoping the model does not retry.
- `lib/policies.ts` evaluates code rules and returns human-readable reasons. `extraRules` is the Stage 3 extension point: extra rules are combined with OR and can only add reasons. Built-in rules are always evaluated, so text cannot remove them.
- `checkOwnership` is separate from approval. An action on another customer's transaction is refused before any hook is created.

**Alternatives considered.**
- Rules in the system prompt: cheapest to write, but a prompt is advisory and cannot be defended as a hard guardrail.
- A database or KV store: the right home for real balances, but new infrastructure and setup for a mock demo.
- Floating-point dollars: simpler, but rounding makes thresholds unreliable.
- Rules inside each tool: fewer files, but harder to test in isolation and easier to duplicate.
- Four mock customers: the three above already cover every rule and the foreign-account case.

**Consequences.**
- The policy module is pure and can be tested without HTTP, Slack or a model. This checkpoint ran 20 checks covering both sides of every threshold, the extra-rule behavior and the reducer idempotency.
- Mock state lives in memory for now. In Stage 2 it will live inside the conversation workflow; a new conversation starts from the JSON. Real balances need a database later.
- Extra rules cannot clear a code reason; that invariant is encoded in the return shape and will be tested in Stage 5.
- The mock is data, not a simulation: no external money moves.
