// The run ID is runtime data; this page must not be prerendered.
export const instant = false;

import { OperatorTimeline } from "./operator-timeline";

export default async function OperatorPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  return <OperatorTimeline runId={runId} />;
}
