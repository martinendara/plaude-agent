"use client";

import { useEffect, useState } from "react";

import { APPROVAL_TIMEOUT_MS } from "@/lib/approval-config";
import type { ApprovalDecision } from "@/lib/approval-types";
import { formatUtc } from "@/lib/format-utc";

type PageState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; runId: string }
  | { phase: "done"; decision: ApprovalDecision }
  | { phase: "error"; message: string };

const POLL_INTERVAL_MS = 3_000;

export default function Home() {
  const [state, setState] = useState<PageState>({ phase: "idle" });
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/approval/${runId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`The server responded with ${response.status}.`);
        }

        const data = (await response.json()) as {
          status: string;
          result?: ApprovalDecision;
        };

        if (cancelled) return;

        if (data.status === "completed" && data.result) {
          setState({ phase: "done", decision: data.result });
          return;
        }

        if (data.status === "failed" || data.status === "cancelled") {
          setState({
            phase: "error",
            message: "The workflow stopped before a decision was recorded.",
          });
          return;
        }

        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;

        setState({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unknown error while polling.",
        });
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  async function requestApproval() {
    setRunId(null);
    setState({ phase: "starting" });

    try {
      const response = await fetch("/api/approval", { method: "POST" });

      if (!response.ok) {
        throw new Error(`The server responded with ${response.status}.`);
      }

      const data = (await response.json()) as { runId: string };
      setRunId(data.runId);
      setState({ phase: "waiting", runId: data.runId });
    } catch (error) {
      setState({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while starting.",
      });
    }
  }

  const busy = state.phase === "starting" || state.phase === "waiting";

  return (
    <main className="flex min-h-svh items-center justify-center bg-zinc-50 px-6 py-16 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="w-full max-w-md">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Plaude engineering challenge
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Approval workflow
        </h1>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Request a fixed approval. The agent posts it to #approvals and pauses
          until a human decides.
        </p>

        <button
          type="button"
          onClick={requestApproval}
          disabled={busy}
          className="mt-8 inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-50"
        >
          {state.phase === "starting"
            ? "Starting…"
            : state.phase === "waiting"
              ? "Waiting for approval…"
              : "Request approval"}
        </button>

        <div
          aria-live="polite"
          className="mt-6 min-h-32 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {state.phase === "idle" && (
            <p className="text-zinc-500 dark:text-zinc-400">
              No request yet. Press the button to start one.
            </p>
          )}

          {state.phase === "starting" && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Starting the workflow…
            </p>
          )}

          {state.phase === "waiting" && (
            <div>
              <p className="font-medium">Waiting for approval in #approvals…</p>
              <p className="mt-2 leading-6 text-zinc-600 dark:text-zinc-400">
                The workflow is paused. It uses no compute while it waits.
              </p>
              <p className="mt-4 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                Run ID: {state.runId}
              </p>
            </div>
          )}

          {state.phase === "done" && <Decision decision={state.decision} />}

          {state.phase === "error" && (
            <p className="text-red-600 dark:text-red-400" role="alert">
              {state.message}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Decision({ decision }: { decision: ApprovalDecision }) {
  if (decision.status === "timed_out") {
    return (
      <div>
        <p className="font-medium text-amber-600 dark:text-amber-400">
          Timed out
        </p>
        <p className="mt-2 leading-6 text-zinc-600 dark:text-zinc-400">
          No decision was recorded within{" "}
          {Math.round(APPROVAL_TIMEOUT_MS / 60_000)} minutes.
        </p>
      </div>
    );
  }

  const approved = decision.status === "approved";

  return (
    <div>
      <p
        className={
          approved
            ? "font-medium text-emerald-600 dark:text-emerald-400"
            : "font-medium text-red-600 dark:text-red-400"
        }
      >
        {approved ? "Approved" : "Rejected"} by @{decision.approver.name}
      </p>
      <p className="mt-2 leading-6 text-zinc-600 dark:text-zinc-400">
        Decided at {formatUtc(decision.decidedAt)}.
      </p>
    </div>
  );
}
