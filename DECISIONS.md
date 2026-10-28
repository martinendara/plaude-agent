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
