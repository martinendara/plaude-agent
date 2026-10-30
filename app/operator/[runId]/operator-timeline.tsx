"use client";

import { useEffect, useState } from "react";

import type {
  ActionTimelineRecord,
  ActionTool,
  PendingTimelineEvent,
  TimelineEvent,
} from "@/workflows/timeline";

const POLL_MS = 2000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

type Snapshot = {
  status: string;
  events: TimelineEvent[];
};

export function OperatorTimeline({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;

    async function poll() {
      if (stopped) return;

      try {
        const response = await fetch(
          `/api/operator/${encodeURIComponent(runId)}`,
          { cache: "no-store" }
        );

        if (cancelled) return;

        if (!response.ok) {
          stopped = true;
          clearInterval(timer);
          setSnapshot({ status: "not_found", events: [] });
          return;
        }

        const data = (await response.json()) as Snapshot;
        if (cancelled) return;

        setSnapshot(data);

        if (TERMINAL.has(data.status)) {
          stopped = true;
          clearInterval(timer);
        }
      } catch {
        if (cancelled) return;
        stopped = true;
        clearInterval(timer);
        setSnapshot({ status: "unavailable", events: [] });
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  return (
    <main className="min-h-svh bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                Acme Ops
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Run timeline
              </h1>
            </div>
            <a
              href="/chat"
              className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-300"
            >
              Back to chat
            </a>
          </div>
          <p className="break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {runId}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Read-only. Approvals happen only in Slack, with a signed request and
            the approver allowlist.
          </p>
          {snapshot && <p className="text-xs text-zinc-500 dark:text-zinc-400">Run status: {snapshot.status}</p>}
        </header>

        {(!snapshot || snapshot.events.length === 0) && (
          <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            No timeline events yet, or this run does not exist.
          </p>
        )}

        {snapshot && snapshot.events.length > 0 && (
          <ol
            aria-label="Run timeline"
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            {snapshot.events.map((event, index) => (
              <EventRow key={`${event.at}-${index}`} event={event} />
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  return (
    <li className="border-l border-zinc-200 pl-4 dark:border-zinc-800">
      <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {event.at.slice(11, 19)} UTC
      </p>
      <div className="mt-1">
        {"kind" in event ? (
          <PendingRow event={event} />
        ) : (
          <ActionRow record={event} />
        )}
      </div>
    </li>
  );
}

function PendingRow({ event }: { event: PendingTimelineEvent }) {
  return (
    <div>
      <p className="text-sm font-semibold">Waiting for approval in Slack</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {event.summary}
      </p>
    </div>
  );
}

function ActionRow({ record }: { record: ActionTimelineRecord }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold">{toolLabel(record.tool)}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {describeInput(record.input) || "—"}
        </p>
      </div>

      {record.rules.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {record.rules.map((rule, index) => (
            <li
              key={`${rule.label}-${index}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <SourceBadge source={rule.source} />
              <span>{rule.label}</span>
            </li>
          ))}
        </ul>
      ) : record.result.status === "completed" ||
        record.result.status === "rejected" ||
        record.result.status === "timed_out" ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No approval needed.
        </p>
      ) : null}

      {record.approval === "timed_out" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Approval timed out.
        </p>
      )}

      {record.approval && record.approval !== "timed_out" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Decided by @{record.approval.decidedBy.name} (
          {record.approval.decidedBy.id}) · {formatTime(record.approval.decidedAt)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ResultBadge record={record} />
        {record.result.error && (
          <span className="font-mono text-[11px] text-zinc-400">
            {record.result.error}
          </span>
        )}
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {record.result.message}
        </span>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: "code" | "text" }) {
  const style =
    source === "code"
      ? "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"
      : "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900";

  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${style}`}
    >
      {source}
    </span>
  );
}

function ResultBadge({ record }: { record: ActionTimelineRecord }) {
  const status = record.result.status;
  const label =
    status === "completed"
      ? record.result.approval === "approved"
        ? "Applied after approval"
        : "Applied by code"
      : status === "rejected"
        ? "Not applied · rejected"
        : status === "timed_out"
          ? "Not applied · timed out"
          : status === "refused"
            ? "Hard block"
            : status === "already_processed"
              ? "Already processed"
              : status === "in_progress"
                ? "Being handled elsewhere"
                : "Error";

  const style =
    status === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "rejected" || status === "error"
        ? "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300"
        : status === "timed_out"
          ? "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300"
          : "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700";

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {label}
    </span>
  );
}

function toolLabel(tool: ActionTool): string {
  switch (tool) {
    case "refund_fee":
      return "Refund fee";
    case "reverse_transaction":
      return "Reverse transfer";
    case "raise_limit":
      return "Raise daily limit";
    case "unlock_account":
      return "Unlock account";
  }
}

function describeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof input.transaction_id === "string") {
    parts.push(input.transaction_id);
  }

  if (typeof input.new_daily_limit === "number") {
    parts.push(`new limit USD ${input.new_daily_limit}`);
  }

  if (typeof input.reason === "string") {
    parts.push(`reason: "${input.reason}"`);
  }

  return parts.join(" · ");
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) return isoDate;

  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}
