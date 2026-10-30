import { getRun } from "workflow/api";

import type { TimelineEvent } from "@/workflows/timeline";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { runId } = await params;

  try {
    const run = getRun(runId);

    if (!(await run.exists)) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    const status = await run.status;
    const events = await readTimeline(runId);

    return Response.json(
      { runId, status, events },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("Operator timeline read failed", error);
    return Response.json({ error: "Run not found" }, { status: 404 });
  }
}

async function readTimeline(runId: string): Promise<TimelineEvent[]> {
  const run = getRun(runId);
  const probe = run.getReadable<TimelineEvent>({
    namespace: "timeline",
    startIndex: 0,
  });
  const tail = await probe.getTailIndex();
  await probe.cancel();

  if (tail < 0) return [];

  const readable = run.getReadable<TimelineEvent>({
    namespace: "timeline",
    startIndex: 0,
  });
  const reader = readable.getReader();
  const events: TimelineEvent[] = [];

  try {
    while (events.length <= tail) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } finally {
    await reader.cancel();
  }

  return events;
}
