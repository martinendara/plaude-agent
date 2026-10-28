"use client";

import { useState } from "react";

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; message: string; runId: string }
  | { status: "error"; message: string };

type HelloResponse = {
  runId: string;
  message: string;
};

export default function Home() {
  const [run, setRun] = useState<RunState>({ status: "idle" });

  async function triggerWorkflow() {
    setRun({ status: "running" });

    try {
      const response = await fetch("/api/hello", { method: "POST" });

      if (!response.ok) {
        throw new Error(`The server responded with ${response.status}.`);
      }

      const data: HelloResponse = await response.json();
      setRun({ status: "success", message: data.message, runId: data.runId });
    } catch (error) {
      setRun({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-zinc-50 px-6 py-16 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="w-full max-w-md">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Plaude engineering challenge
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Workflow spike
        </h1>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Trigger a Workflow DevKit run with one step. The step returns a
          message; the page shows what comes back.
        </p>

        <button
          type="button"
          onClick={triggerWorkflow}
          disabled={run.status === "running"}
          className="mt-8 inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-50"
        >
          {run.status === "running" ? "Running…" : "Run workflow"}
        </button>

        <div
          aria-live="polite"
          className="mt-6 min-h-28 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {run.status === "idle" && (
            <p className="text-zinc-500 dark:text-zinc-400">
              No run yet. Press the button to start one.
            </p>
          )}
          {run.status === "running" && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Workflow running…
            </p>
          )}
          {run.status === "success" && (
            <div>
              <p className="font-medium">Result</p>
              <p className="mt-2 font-mono text-base">{run.message}</p>
              <p className="mt-4 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                Run ID: {run.runId}
              </p>
            </div>
          )}
          {run.status === "error" && (
            <p className="text-red-600 dark:text-red-400" role="alert">
              {run.message}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
