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

**Decision.** `lib/model.ts` selected `gemini-3.6-flash` through `google()` from `@ai-sdk/google@3.0.139`. The Google provider exports `google` and `createGoogleGenerativeAI` in 3.x; the `createGoogle` alias only exists in 4.x. The model factory is a step (see D11). After the Groq comparison (D16), Gemini is the documented fallback; Groq is the primary model.

**Alternatives considered.**
- `gemini-3.8-flash` (new stable): the free-tier call measured about 71 seconds for one short sentence in this project, versus 26–33 seconds for 3.6.
- `gemini-3.5-flash-lite`: faster (about 18 seconds) but a lighter model; kept as a one-line fallback.
- `gemini-2.5-flash`: free but access-limited to projects that used it in the past; not safe for a new demo.
- `gemini-flash-latest`: a hot-swapped alias, not reproducible.
- AI Gateway or a paid model: excluded by the zero-spend rule.

**Consequences.**
- Free-tier latency is visible: a short direct call to 3.6 Flash measured 26–33 s end to end and 27 s to the first streamed token; a full DurableAgent workflow measured about 54 s. Flash-Lite measured about 18 s. It varies by load and project quota.
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
- `raise_limit` rejects non-positive limits and limits that do not exceed the current one with `invalid_limit` / `limit_not_increased`. The tool layer will also refuse before asking for approval.
- Mock state lives in memory for now. In Stage 2 it will live inside the conversation workflow; a new conversation starts from the JSON. Real balances need a database later.
- Extra rules cannot clear a code reason; that invariant is encoded in the return shape and will be tested in Stage 5.
- The mock is data, not a simulation: no external money moves.

## D14. One reusable approval helper with a random token, resumable only from the signed Slack endpoint

**Context.** Stage 2 tools need the same durable pause as the Stage 1 demo. Copying the Stage 1 workflow into each tool would let the two paths drift. The token must not be derived from model output, and the chat API must not be able to resume an approval.

**Decision.** `workflows/approval-request.ts` exposes `requestApproval({ request, timeoutMs })` at workflow level (no `"use workflow"`), so tools can await it. It:
- generates the token with `createHookToken()` (a `crypto.randomUUID()` in a step), not with the tool call ID;
- creates the hook and awaits `getConflict()` before Slack sees the token;
- posts a structured Block Kit message;
- races the hook against `sleep(timeoutMs)`;
- disposes the hook on timeout, so a late click cannot resume an approval the run already gave up on;
- updates the Slack message and returns `{ status, approver, decidedAt }`.

`workflows/approval.ts` is now a thin adapter over the helper. Approval hooks are resumed only by `POST /api/slack/interactions`, after signature verification and the allowlist. The future chat endpoint resumes only the chat-message hook by `runId`, never an approval hook.

**Alternatives considered.**
- Tool call ID as token: convenient routing, but the token would be derived from model output, easy to correlate, and would invite a chat endpoint to resume it. The Stage 1 random token is kept deliberately.
- Duplicate the Stage 1 code in each tool: guaranteed drift in timeout, disposal, Slack updates and authorization.
- A raw `createWebhook()` URL in Slack: the URL would be the only authorization.
- Let `/api/chat` resume any hook: a compromised chat client could approve a financial action.

**Consequences.**
- One code path for signature, allowlist, idempotency, timeout and message updates.
- The helper is workflow-level; tools call it without `"use step"`.
- A click after the timeout finds no hook and the route acknowledges it with `200`.
- The token is visible to channel members; it is not the authentication. D6 and D10 remain the security boundary.

## D15. Store the approver's Slack name and user ID

**Context.** D10 authorizes by immutable Slack user ID, but the hook payload stored only a display name. Names change and are not unique; a regulated wallet needs to record who approved.

**Decision.** Introduce `Approver = { id, name }`. The interactions route fills both from the Slack payload, the hook payload and the decision carry both, the Slack decision message shows `@name (U…)`, and the Stage 1 page shows the name. Authorization keeps using only the ID.

**Alternatives considered.**
- Name only: readable but mutable and ambiguous.
- ID only: unambiguous but unreadable for a human reviewing a run.
- Logs only: runtime logs last one hour on Hobby; not an audit trail.

**Consequences.**
- The payload and result shapes changed; the Stage 1 page was updated.
- Names are display data; the ID remains the authorization and audit key.
- Slack messages show both, so an approver can be traced without opening the app.

## D16. Groq gpt-oss-120b becomes the primary model after a measured comparison

**Context.** Gemini 3.6 Flash was correct but slow on the free tier: 26–33 s end to end and 27 s to the first streamed token. A chat demo needs a faster first response without adding cost or breaking the `ai@6` / provider-v3 stack required by `DurableAgent` (D11).

**Test.** On 2026-10-29, the same prompt and the same tool (`reverse_transaction` with `transaction_id` and `reason`):
- Groq `openai/gpt-oss-120b`, `reasoningEffort: "low"`: 543 ms; called the tool with `{ transaction_id: "TX-1042", reason: "Transfer went to the wrong person" }`.
- Google `gemini-3.6-flash`: 27,147 ms; called the tool with `transaction_id: "TX-1042"` and an equivalent reason.
- The active model list of the Groq account included both `openai/gpt-oss-120b` and `openai/gpt-oss-20b`. The 120b candidate worked, so the 20b fallback was not called.
- The Groq free tier allows 8,000 tokens per minute; low reasoning and short prompts keep the test and the demo within it.

**Decision.** `lib/model.ts` uses Groq `openai/gpt-oss-120b` with `reasoningEffort: "low"` as the primary model. Gemini 3.6 Flash remains the documented **manual** fallback behind a one-constant switch (no automatic failover); the Google provider stays installed. `@ai-sdk/groq@3.0.79` (the `ai-v6` line) is pinned exactly. `GROQ_API_KEY` joins `.env.example`, the README and the Vercel variables.

**Alternatives considered.**
- Keep Gemini as primary: correct tool call, but 27 s is too slow for a chat demo.
- Groq `openai/gpt-oss-20b`: lighter, but the 120b worked; keep it as the Groq fallback if the 120b is unavailable or rate-limited.
- Raw OpenAI-compatible HTTP instead of the provider: would require reimplementing tool calling and would not be a fair comparison.
- AI Gateway: excluded by the zero-spend rule.

**Consequences.**
- The model factory stays in one file; switching back to Gemini changes one constant and the provider options.
- `GROQ_API_KEY` must be set in `.env.local` and in Vercel, and the deployment must be redeployed.
- The comparison is one sample per model; latency varies with load. The gap (543 ms vs 27 s) is large enough to decide.
- `@ai-sdk/groq@3.0.79` is compatible with provider v3 and `ai@6`; a future `ai@7` migration would need the 4.x line.
- Reasoning effort low lowers output tokens and latency but may reduce reasoning quality; the guardrails remain in code, so the model's reasoning is not the safety boundary.
- Groq's API policy says Groq does not train on API data. Gemini's free tier may use prompts to improve its products, but only if an operator enables the manual fallback.

## D17. Tools trust the wallet, not the model

**Context.** A model can invent IDs, amounts, recipient status or lock reasons, and customer text can try to talk it into bypassing a rule. Guardrails are only as strong as the data they evaluate.

**Decision.**
- The five tools are `lookup_account`, `refund_fee`, `reverse_transaction`, `raise_limit` and `unlock_account`. None accepts a customer ID.
- `refund_fee` and `reverse_transaction` accept only `transaction_id` and the customer's `reason`; `raise_limit` accepts the new limit; `unlock_account` accepts the reason. Amounts, `recipientReceived`, `lockReason` and the current limit are read from the wallet before `evaluateGuardrails`.
- Ownership is checked before any approval. A transaction that belongs to another customer returns `refused`; it never creates a hook or posts to Slack.
- A refund or reversal on an account locked for suspected fraud always requires approval, with the reason "Account locked for suspected fraud". This is an additive code rule: it does not block the action and plain text cannot remove it.
- Missing `recipientReceived` is treated as `true` in the reversal policy, so an unknown recipient state fails closed.
- Write actions run through one serialized action queue per conversation, inside memoized steps, so concurrent tool calls cannot overwrite each other and replay does not apply an action twice. Reducers are idempotent by transaction state.
- Slack messages are assembled from code data (customer, amount, rule). Customer-provided text is escaped and labeled `Customer says:` before it enters mrkdwn.
- The temporary instructions list the real tool states (`completed`, `rejected`, `timed_out`, `refused`) and error codes (`transaction_not_found`, `not_a_fee`, `not_a_transfer`, `already_done`, `invalid_limit`, `limit_not_increased`, `already_unlocked`, `account_not_found`). The code, not the model, decides.

**Alternatives considered.**
- Trust model-supplied amounts and statuses: a prompt could inflate or deflate the facts the policy evaluates.
- Per-tool approval code: duplication and drift.
- Optimistic writes: lost updates when two tools run concurrently.
- Prompt-only ownership: a social-engineering message could convince the model to act.
- Raw customer text in Slack: formatting and mention injection.

**Consequences.**
- A wrong model cannot loosen a code rule; the tool result, not the model, is the source of truth.
- The tool schemas are narrower, so the model must look up facts first.
- One action runs at a time per conversation; a pending approval holds later actions in the queue.
- An approver sees code-built facts and a clearly labeled customer quote.

## D18. One workflow per conversation, and the chat API cannot resume approvals

**Context.** The chat needs history and mock account state across turns without a database. Approval hooks must remain reachable only through the signed Slack endpoint.

**Decision.** One workflow run owns a conversation. A chat hook with `token = runId` receives each user message; the first message is passed as a workflow argument and runs the first turn. The workflow keeps the model messages and the wallet state in local variables and streams each turn with `preventClose: true, sendFinish: true`; the API slices the durable stream at each turn's `finish`. `POST /api/chat` starts a run when there is no `runId` and resumes the chat hook when there is one. `customerId` is accepted only at start and ignored afterwards. The route calls only `chatMessageHook.resume`; it never calls `resumeHook` or an approval hook. Approval hooks remain exclusive to `/api/slack/interactions`. `/done` ends the conversation; `maxTurns` bounds a run.

**Alternatives considered.**
- One run per turn: needs an external store for wallet state and loses cross-turn balances.
- Client-held state: untrusted and tamperable.
- Resuming approvals from the chat route: a compromised client could approve money movements.
- A database: new infrastructure for a mock demo.

**Consequences.**
- State is durable within a conversation and resets when a new one starts.
- Waiting uses no compute; the run stays open while the human decides.
- The UI must send `runId` on every follow-up.
- `/api/chat` returns `409` with a clear message when the conversation ended or the run is not an active chat, instead of surfacing a resume error as `500`.
- There is no GET stream reconnect route. A stream cut by the 300-second function limit is not resumed in the browser, but the workflow keeps running.
- `/api/chat` has no user authentication yet; the demo exposes the run ID.

## D19. Rate limits become a friendly message, not a blank stream

**Context.** Groq's and Gemini's free tiers return `429` under load. A raw provider error would end the turn and could leave the UI stream without a `finish` chunk.

**Decision.** The chat workflow wraps each agent turn in `try/catch`. `isRateLimitError` recognizes `APICallError` status 429 and common provider shapes. On failure the workflow writes a friendly text plus `finish` chunk to the durable stream through a step, appends the same text to the model history, and keeps the conversation alive. Other failures get a generic "something went wrong" message.

**Alternatives considered.**
- Retry inside the agent: a limited free tier may stay limited and consume the minute's tokens.
- Surface the provider error: bad UX and leaks implementation detail.
- Let the run fail: the UI would show a blank or stuck turn.

**Consequences.**
- The user sees a normal assistant message and can try again.
- The error is logged for the operator.
- The fallback is exercised on a real 429; four short messages in the Tramo 3 test did not trigger one.

## D20. A fraud lock adds approval to refunds and reversals

**Context.** With Ana locked for suspected fraud, the model refused a reversal before calling a tool, so the decision depended on the model. A lock should not silently block an action a human could approve.

**Decision.** `PolicyContext` carries `accountLockedForFraud`. When true, `refund_fee` and `reverse_transaction` always require approval with the reason "Account locked for suspected fraud". The rule only adds a reason; the amount and recipient rules still apply. The temporary instructions tell the model to call the tool and let the code open the approval instead of refusing on its own. Missing `recipientReceived` is treated as `true`, so an unknown recipient state fails closed.

**Alternatives considered.** Keep the model-side refusal (nondeterministic), hard-block locked accounts (no human override), add the rule only to the prompt (advisory).

**Consequences.** Ana's USD 80 reversal now reaches Slack even below the USD 100 threshold; the model no longer decides policy; the approval message shows the fraud-lock reason; the reducer still validates.

## D21. Minimal chat UI with WorkflowChatTransport

**Context.** The page must stream per-turn replies and carry the conversation run ID without a database. Workflow DevKit's DurableAgent-era transport already handles UI message streams.

**Decision.** `/chat` is a client page using `useChat` from `@ai-sdk/react` and `WorkflowChatTransport` from `@workflow/ai`. `sendMessage` carries `runId` and, on the first turn, `customerId` in the request body; the response header `x-workflow-run-id` is stored in state. The chat mounts after hydration with a small loading guard, because `useChat` generates random IDs and Next's prerender rejects them under `cacheComponents`. The demo customer selector is disabled after the first message. `/` remains the Stage 1 approval page.

**Alternatives considered.** A custom SSE parser (more code for a solved problem), replacing the Stage 1 demo (loses the approval debug page), server actions (no streaming).

**Consequences.** The page is minimal and will be replaced in Stage 4; no GET reconnect route exists, so a cut stream surfaces as an error in the UI; the run ID lives in React state and is lost on refresh (Stage 4 can persist it).

## D22. `instructions/agent.md` is the source of truth, compiled at build time

**Context.** The brief asks for base plain-text instructions that describe when a human must decide. Stage 2 kept the prompt in `lib/agent-instructions.ts`, which is not plain text and forces a code change. The Workflow DevKit workflow body must be deterministic and cannot do I/O (D3), and Vercel only ships files that its tracer sees; a runtime `fs.readFile` of `instructions/agent.md` from a step is not guaranteed to find the file in production. No new dependency may be added without asking.

**Decision.** `instructions/agent.md` is the only file an editor touches. `scripts/generate-agent-config.mts` reads and validates it at build time and writes `lib/generated/agent-config.ts` (committed) with `AGENT_PROMPT` (the markdown without the machine-readable rules block) and `TEXT_RULES`. `npm run predev` and `npm run prebuild` regenerate the module. The workflow imports it statically, so the text travels in the bundle. Node 22's built-in type stripping runs the script, so no `tsx` or loader is added. `allowImportingTsExtensions` is enabled because the script imports `../lib/agent-rules.ts`.

**Problem solved:** the instructions are editable without touching code, and they deploy reliably without a new dependency or untraced runtime files.

**Without it:** the prompt stays a TypeScript string (the brief is not met), or the app reads the file at runtime and fails on Vercel when the asset is not in the step bundle. A new loader dependency would also have to be justified and approved.

**Alternatives considered.** Read the file in a step (`fs.readFile`): conceptually correct, but asset tracing across the Workflow step bundle is not documented or verified. `raw-loader` or a Turbopack rule: a new dependency. Read from `public/` with `fetch`: a network call and a publicly served prompt. Keep the prompt in a `.ts` file: not plain text.

**Consequences.** Editing the file requires `npm run generate:agent` or a dev restart, and a deploy for production. The generated file must not be hand-edited; it says so in its header. A build that bypasses npm scripts uses the committed module, which is valid but may be stale. The prose and the rules block are separated: the model never sees the rule syntax, which saves tokens on Groq's 8k/minute free tier.

## D23. A constrained, additive rule DSL parsed in code

**Context.** The text must be able to add an approval that the code does not have (the Stage 3 demo: raising a limit on a locked account), while the hard rules stay in code (D13, D17). Parsing by the model would make the rule nondeterministic and injectable. A general expression language would be hard to audit and test.

**Decision.** `agent.md` contains one fenced `rules` block. The grammar is deliberately small:

```
rule <tool> when <fact> is <literal> reason "<label>"
rule <tool> when <fact> > <number> reason "<label>"
```

Tools: `refund_fee`, `reverse_transaction`, `raise_limit`, `unlock_account`. Facts: `account.locked`, `account.lock_reason`, `amount_usd`, `recipient_received`, `current_limit_usd`, `new_limit_usd`, each allowed only on the tools where it exists. There is no `and`, `or`, negation, arithmetic, `allow`, or `unless`: two conditions are two rules, and evaluation is OR. Rules compile to `extraRules`, which `evaluateGuardrails` already combines with OR, so text can add reasons and never clear a code reason. The Slack message shows the text rule's label.

**Problem solved:** an editor can add or lower an approval threshold with one line, and the code still decides deterministically.

**Without it:** editing the text only changes the model's prose, which is advisory; the Stage 3 checkpoint ("editing the text changes behavior without code changes") could not be demonstrated with an actual approval.

**Alternatives considered.** Prose-only rules: no guarantee. Model-parsed rules: nondeterministic and a prompt-injection surface. A full expression language or JSONLogic: more power than the demo needs and much more surface to test.

**Consequences.** A new policy dimension needs a new fact in code; the language does not grow by itself. Thresholds are not repeated in the prose, so one source of truth. `PolicyContext` now carries generic `locked` and `lockReason`; D20's `accountLockedForFraud` remains.

## D24. Fail closed on invalid instructions, at build and at runtime

**Context.** A rule that is silently skipped is a bypass: the editor believes an approval is configured and the code does not ask for it. D10 established the same principle for the approver allowlist. A literal "the app refuses to start" is not achievable on Vercel serverless, where every instance cold-starts and there is no reliable startup hook.

**Decision.** The generator validates syntax, tool, fact, fact/tool compatibility, literal type, USD format, duplicate rules, block count and block closure. Any error prints `instructions/agent.md:<line>: <message>` and exits 1, so `npm run build` and `npm run deploy` never produce a bundle with partial rules. At runtime, `compileTextRules` re-validates the generated data; the chat route returns a `500` with the same `file:line` message before starting a run, and the workflow throws a `FatalError` as a second barrier. A missing `rules` block is valid and means zero extra rules; a missing file, an unknown symbol, or an unclosed block is fatal.

**Problem solved:** an invalid edit cannot silently weaken the workflow, and the failure names the exact line.

**Without it:** a typo such as `account.bloqued` disables the intended approval without any visible symptom until money moves.

**Alternatives considered.** Skip unknown lines with a warning: the exact failure mode this design avoids. Validate only at runtime: the bad file can deploy, and the stream can hang. Validate only at build: a hand-edited generated module bypasses it. Both layers are used.

**Consequences.** A broken file blocks development and deployment until fixed, by design. Runtime validation adds a few milliseconds per run. The literal "refuses to start" is replaced by "refuses to build/deploy" plus "refuses to run with a clear error", which is enforceable.

## D25. The conversation history excludes the system message

**Context.** The AI SDK warns on the second turn that system messages in `messages` can enable prompt injection. `DurableAgent` prepends the `instructions` as a system message, returns the full conversation prompt in `result.messages`, and the chat loop fed that back on the next turn. The prompt therefore contained a second copy of the system prompt, then a third, and so on.

**Decision.** `workflows/chat.ts` stores `result.messages.filter((message) => message.role !== "system")`. `DurableAgent` re-adds `instructions` on every call.

**Problem solved:** removes the warning, removes the duplicated prompt and keeps token growth proportional to the conversation.

**Without it:** every turn paid for an extra copy of the system prompt. Measured on a five-turn conversation with `openai/gpt-oss-120b`: input tokens went 808 → 2,448 before the fix and 808 → 993 after it (turn 5, about 59% fewer input tokens); the warning appeared on turns 2–5 before and disappeared after.

**Alternatives considered.** `allowSystemInMessages: true`: silences the warning but keeps the duplication and the injection surface. Passing `system` instead of `instructions`: same result. Removing `instructions`: loses the prompt.

**Consequences.** The history contains only user, assistant and tool messages. A future migration to `WorkflowAgent` should keep the same invariant.

## D26. One transaction action at a time across conversations, with a retained done marker

**Context.** The wallet lives in a per-run clone loaded from `data/customers.json` (`lib/wallet.ts:59`, `workflows/chat.ts:39`). Nothing writes the JSON, and the action queue is per conversation (`workflows/agent-tools.ts:25-58`). Two conversations could refund the same fee twice; even sequentially, a new conversation starts from the pristine data and could refund it again. The tool already re-validated at apply time, but only against its own clone.

**Decision.** `refund_fee` and `reverse_transaction` claim the transaction before reading the wallet:

1. Create a lock hook with the custom token `wallet-tx:<transactionId>` and await `getConflict()`. Custom tokens are globally unique while active and registration is atomic (Workflow DevKit docs: run idempotency and `createHook`). If the token is taken, another active run owns it.
2. While holding the lock, look up `wallet-tx:<transactionId>:done`. If it exists, release the lock and return `already_processed`. If the lock was taken and no marker exists, return `in_progress`.
3. Do the work. On success, create the done hook with `experimental_minRetention: "30d"`, then release the lock. On rejection, timeout, validation error or any thrown error, release the lock and do not create the marker.

The ordering matters: the done marker is created **before** the lock is released, so a run that acquires the lock afterwards is guaranteed to see the marker.

**Problem solved:** exactly one action is applied per transaction, even across parallel or later conversations. The agent reports "already processed" or "being handled" and never claims a second refund.

**Without it:** two conversations can each refund `TX-1041` and add the amount to their own clone. The second conversation can also do it after the first one ends, because the JSON never changed.

**Alternatives considered.** An in-memory mutex: does not cross serverless instances. A database or KV store with compare-and-set: the correct long-term design, but new infrastructure and cost, outside the zero-spend rule. A single claim hook with 30-day retention: if the holder fails or is cancelled, the token stays reserved for 30 days and blocks legitimate retries. The two-hook design releases the lock when the run ends (Workflow DevKit disposes hooks when a workflow ends) and retains only the done marker after success.

**Consequences.** A successful transaction is marked for 30 days on the free tier (Vercel caps `experimental_minRetention` at 30 days). Rejected or timed-out attempts release the lock, so they can be retried. A run cancelled in the narrow window between the mutation and the done-marker creation could allow a later attempt: steps are durable and replay, so this requires a terminal cancellation at that exact point; documented as a known limitation. The claim does not share wallet balances: two different actions on one account still mutate two clones. That remains a Stage 4+ concern (shared store). Waiting runs use no compute, and Hobby's 50,000 events/1 GB written allowances cover the few extra hook events; Workflow Data Retained is not billed on Hobby.

**Known limits of the claim.**
- **Window between apply and markProcessed.** If a run is terminally cancelled after the mutation step commits and before the done marker is registered, the lock dies with the run and no marker exists, so a later conversation could apply the action again. Workflow steps replay from the event log, so this needs a terminal cancellation in that exact window, not a normal crash. A real wallet would not use two separate operations: it would apply the balance change and record the idempotency key in one atomic write, or pass an idempotency key to the payment processor that performs both. The mock has no store, so this stays a documented Stage 5 test case and a requirement for the Stage 4+ shared store.
- **`experimental_minRetention` is experimental.** Its name and accepted values can change, the World must support it (registration fails otherwise), and the Vercel World caps it at 30 days. The option is pinned to the installed `workflow` version, so an upgrade must re-check both the option and its behavior.
- **`raise_limit` and `unlock_account` do not use a claim.** They change account-level fields, not a transaction, and the reducers limit repetition: a second raise to the same limit fails with `limit_not_increased`, and a second unlock fails with `already_unlocked`. Neither moves money. Two conversations can still diverge on limits or lock state because each has its own clone; that is the same per-run balance limitation noted above, not a double payment. If exact account-level idempotency is needed later, the next step is the same claim keyed by customer, or the shared store.

## D27. Operator timeline from a namespaced durable stream, read-only

**Context.** An operator needs to see, per conversation, what was requested, which rule stopped it (code or text), what happened in Slack, who decided and when, and what was applied. The Workflow DevKit event log persists step events, but it is not exposed to the app as a domain timeline, and `getRun()` retrieves a run only by ID. The panel must not become a second approval path: approval stays in Slack, with the signature check and the approver allowlist.

**Decision.**
- The workflow writes one **action record** per action to a namespaced stream, `timeline`: `{ at, tool, input, rules: [{ label, source: "code" | "text" }], approval?: { decidedBy: { id, name }, decidedAt } | "timed_out", result }`. It is written in the single wrapper every action tool goes through, not in each tool. `requestApproval` adds one `pending` event when the Slack message is posted.
- `GET /api/operator/[runId]` reads the stream with `getRun(runId).getReadable({ namespace: "timeline", startIndex: 0 })` up to `getTailIndex()`. No new database and no extra index.
- `/operator/[runId]` renders the records, polls every 2 seconds, and stops when the run is terminal. Empty and not-found share one message. The panel is read-only: no approve or reject buttons, only a back link.
- The Slack approval message and the chat link to the panel. The Slack URL is built from `APP_BASE_URL`; the chat uses a relative link.

**Problem solved:** the operator can see the full action, rule, decision and outcome without a new store, and the approval path remains single.

**Without it:** the operator would be blind between Slack and the final result, or would need a database just to reconstruct what the run already knows. Adding approval buttons to the panel would create a second authorization path that does not have the Slack signature and allowlist.

**Alternatives considered.**
- A KV/database timeline: new infrastructure and a second source of truth; the durable stream already persists across suspension and restarts.
- Reading the event log through World internals: not a public app API and coupled to the runtime.
- Deriving the timeline from the customer UI stream: mixes operator data into the customer stream and reads chat chunks, not domain events.
- Approve/reject in the panel: rejected by principle, even with a login.

**Consequences.**
- No conversation list: a run is opened from the Slack or chat link. A cross-device list needs an index/store and is future work.
- No authentication on the panel: anyone with the run ID can read approver names and IDs. It is documented as the next step (operator allowlist or a signed session).
- A chat run stays `running` while the conversation is open, so polling continues until `/done` or the run ends. The polling cost is small on Hobby but is not free; the page stops on terminal status and does not load-test.
- One record per action is deliberately less detailed than a full event log: intermediate model text is not part of the operator timeline.
- `pending` is a single extra event, so an operator sees the wait before the action record closes.
