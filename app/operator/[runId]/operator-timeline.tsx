"use client";

import { useEffect, useState, type ReactNode } from "react";

import { formatUsd, formatUsdCompact } from "@/lib/money";
import type { ApprovalCustomer } from "@/lib/approval-types";
import type {
  ActionTimelineRecord,
  ActionTool,
  PendingTimelineEvent,
  TimelineEvent,
  TimelineRule,
} from "@/workflows/timeline";

const POLL_MS = 2000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RUN_STATUSES = new Set(["running", "completed", "failed", "cancelled"]);

type Snapshot = {
  status: string;
  events: TimelineEvent[];
};

type IconKind =
  | "applied"
  | "waiting"
  | "processed"
  | "rejected"
  | "timed_out"
  | "blocked"
  | "error"
  | "in_progress";

export function OperatorTimeline({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
        setUpdatedAt(new Date().toISOString().slice(11, 19));

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

  const events = snapshot?.events ?? [];
  const customer = latestCustomer(events);
  const visibleEvents = events.filter(
    (event, index) => !isPending(event) || index === events.length - 1
  );
  const showRunPill = snapshot && RUN_STATUSES.has(snapshot.status);

  return (
    <main className="min-h-svh bg-white px-5 py-10 text-zinc-900 dark:bg-[#0b0b0c] dark:text-zinc-100">
      <section className="mx-auto w-full max-w-3xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Acme ops · Read only
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {customer?.name ?? "Unknown customer"}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="max-w-[22rem] truncate font-mono" title={runId}>
                {runId}
              </span>
              <span aria-hidden>·</span>
              <span>{lockLabel(customer)}</span>
            </p>
          </div>

          {showRunPill && (
            <RunPill status={snapshot.status} updatedAt={updatedAt} />
          )}
        </header>

        {snapshot && visibleEvents.length === 0 && (
          <p className="mt-8 border-t border-zinc-200 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No timeline events yet, or this run does not exist.
          </p>
        )}

        {visibleEvents.length > 0 && (
          <ol
            aria-label="Run timeline"
            className="mt-7 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
          >
            {visibleEvents.map((event, index) => (
              <EventRow key={`${event.at}-${index}`} event={event} />
            ))}
          </ol>
        )}

        <footer className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span className="flex items-center gap-2">
            <RuleBadge source="code" /> rule in code
          </span>
          <span className="flex items-center gap-2">
            <RuleBadge source="text" /> rule from instructions/agent.md
          </span>
          <span>Approvals happen only in Slack</span>
          <a
            href="/chat"
            className="ml-auto underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            Back to chat
          </a>
        </footer>
      </section>
    </main>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-4 py-5">
      {isPending(event) ? (
        <>
          <StatusIcon kind="waiting" />
          <PendingBody event={event} />
        </>
      ) : (
        <>
          <StatusIcon kind={iconKind(event)} />
          <ActionBody record={event} />
        </>
      )}
      <time
        className="pt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
        dateTime={event.at}
        title={event.at}
      >
        {clock(event.at)}
      </time>
    </li>
  );
}

function PendingBody({ event }: { event: PendingTimelineEvent }) {
  return (
    <div className="min-w-0">
      <p className="text-[15px] font-semibold leading-6 tracking-tight">
        {pendingTitle(event)}
      </p>

      <Rules rules={event.rules ?? []} />

      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-amber-600 dark:text-amber-400">
        <SlackIcon />
        Waiting for a human in Slack #approvals · expires{" "}
        {clock(new Date(new Date(event.at).getTime() + event.timeoutMs).toISOString())}
      </p>
    </div>
  );
}

function ActionBody({ record }: { record: ActionTimelineRecord }) {
  const result = resultView(record);
  const slack = slackLine(record);

  return (
    <div className="min-w-0">
      <p className="text-[15px] font-semibold leading-6 tracking-tight">
        {actionTitle(record)}
      </p>

      <Rules rules={record.rules} />

      {slack && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
          <SlackIcon />
          {slack}
        </p>
      )}

      <p className={`mt-1.5 text-[13px] font-medium ${result.tone}`}>
        {result.label}
      </p>
    </div>
  );
}

function Rules({ rules }: { rules: TimelineRule[] }) {
  if (rules.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {rules.map((rule, index) => (
        <li
          key={`${rule.label}-${index}`}
          className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300"
        >
          <RuleBadge source={rule.source} />
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}

function RuleBadge({ source }: { source: "code" | "text" }) {
  return source === "code" ? (
    <span className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      CODE
    </span>
  ) : (
    <span className="rounded bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-indigo-500">
      TEXT
    </span>
  );
}

function RunPill({ status, updatedAt }: { status: string; updatedAt: string | null }) {
  const style =
    status === "running"
      ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900"
      : status === "completed"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900"
        : status === "failed"
          ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900"
          : "bg-zinc-100 text-zinc-600 ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700";

  const glyph =
    status === "running"
      ? "▷"
      : status === "completed"
        ? "✓"
        : status === "failed"
          ? "✕"
          : "–";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      <span aria-hidden>{glyph}</span>
      <span className="capitalize">{status}</span>
      {updatedAt && (
        <span className="opacity-70">· updated {updatedAt}</span>
      )}
    </span>
  );
}

function StatusIcon({ kind }: { kind: IconKind }) {
  const style = ICON_STYLE[kind];

  return (
    <span
      className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${style.className}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {style.path}
      </svg>
    </span>
  );
}

const ICON_STYLE: Record<IconKind, { className: string; path: ReactNode }> = {
  applied: {
    className:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    path: <path d="M20 6 9 17l-5-5" />,
  },
  waiting: {
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  processed: {
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    path: <path d="m2 12 5 5L22 2M2 19l5-5" />,
  },
  rejected: {
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    path: <path d="M18 6 6 18M6 6l12 12" />,
  },
  timed_out: {
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  blocked: {
    className: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
    path: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  error: {
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    path: (
      <>
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  },
  in_progress: {
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
};

function SlackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
    </svg>
  );
}

function latestCustomer(events: TimelineEvent[]): ApprovalCustomer | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const customer = events[index].customer;
    if (customer) return customer;
  }

  return undefined;
}

function lockLabel(customer: ApprovalCustomer | undefined): string {
  if (!customer) return "account state unknown";
  if (!customer.locked) return "account unlocked";
  if (!customer.lockReason) return "account locked";

  return `account locked: ${customer.lockReason.replace(/_/g, " ")}`;
}

function isPending(
  event: TimelineEvent
): event is PendingTimelineEvent {
  return "kind" in event;
}

function iconKind(record: ActionTimelineRecord): IconKind {
  switch (record.result.status) {
    case "completed":
      return "applied";
    case "rejected":
      return "rejected";
    case "timed_out":
      return "timed_out";
    case "refused":
      return "blocked";
    case "already_processed":
      return "processed";
    case "in_progress":
      return "in_progress";
    case "error":
      return "error";
  }
}

function resultView(record: ActionTimelineRecord): {
  label: string;
  tone: string;
} {
  switch (record.result.status) {
    case "completed":
      return {
        label:
          record.result.approval === "approved"
            ? "Applied after approval"
            : "Applied by code",
        tone: "text-emerald-600 dark:text-emerald-400",
      };
    case "rejected":
      return {
        label: "Not applied · rejected",
        tone: "text-red-600 dark:text-red-400",
      };
    case "timed_out":
      return {
        label: "Not applied · timed out",
        tone: "text-amber-600 dark:text-amber-400",
      };
    case "refused":
      return {
        label: "Hard block · another customer's transaction",
        tone: "text-zinc-500 dark:text-zinc-400",
      };
    case "already_processed":
      return {
        label: "Already processed in another conversation",
        tone: "text-sky-600 dark:text-sky-400",
      };
    case "in_progress":
      return {
        label: "Being handled in another conversation",
        tone: "text-sky-600 dark:text-sky-400",
      };
    case "error":
      return {
        label: `Error · ${record.result.error ?? "unexpected_error"}`,
        tone: "text-red-600 dark:text-red-400",
      };
  }
}

function slackLine(record: ActionTimelineRecord): string | null {
  if (!record.approval) return null;

  if (record.approval === "timed_out") {
    return "Slack #approvals · no decision";
  }

  const verb = record.result.status === "rejected" ? "rejected" : "approved";

  return `Slack #approvals · ${verb} by ${record.approval.decidedBy.name} ${record.approval.decidedBy.id} at ${clock(record.approval.decidedAt)}`;
}

function actionTitle(record: ActionTimelineRecord): string {
  const transactionId =
    typeof record.input.transaction_id === "string"
      ? record.input.transaction_id
      : undefined;

  if (record.tool === "raise_limit" && record.limits) {
    return `${toolLabel(record.tool)} · ${formatUsdCompact(record.limits.currentCents)} → ${formatUsdCompact(record.limits.newCents)}`;
  }

  const amount =
    record.amountCents !== undefined ? ` · ${formatUsd(record.amountCents)}` : "";

  return transactionId
    ? `${toolLabel(record.tool)} · ${transactionId}${amount}`
    : toolLabel(record.tool);
}

function pendingTitle(event: PendingTimelineEvent): string {
  if (event.amountCents === undefined || event.summary.includes("USD")) {
    return event.summary;
  }

  return `${event.summary} · ${formatUsd(event.amountCents)}`;
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


function clock(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) return isoDate;

  return date.toISOString().slice(11, 19);
}
