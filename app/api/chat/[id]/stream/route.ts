import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun } from "workflow/api";

// Read-only reconnect endpoint for WorkflowChatTransport. It never resumes a
// hook: approvals stay exclusive to the signed Slack route.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const rawStartIndex = searchParams.get("startIndex");

  const parsed =
    rawStartIndex === null ? undefined : Number.parseInt(rawStartIndex, 10);
  const startIndex =
    parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;

  const run = getRun(id);

  if (!(await run.exists)) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const readable = run.getReadable<UIMessageChunk>({ startIndex });
  const tailIndex = await readable.getTailIndex();

  return createUIMessageStreamResponse({
    stream: readable,
    headers: {
      "x-workflow-stream-tail-index": String(tailIndex),
      "cache-control": "no-store",
    },
  });
}
