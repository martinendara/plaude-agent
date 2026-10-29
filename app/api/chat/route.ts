import {
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { getRun, start } from "workflow/api";

import { findAccount, loadWallet } from "@/lib/wallet";
import { chatWorkflow } from "@/workflows/chat";
import { chatMessageHook } from "@/workflows/chat-hooks";

type ChatBody = {
  messages?: UIMessage[];
  runId?: string;
  customerId?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ChatBody;
  const message = lastUserText(body.messages);

  if (!message) {
    return Response.json({ error: "Missing user message" }, { status: 400 });
  }

  if (body.runId) {
    const run = getRun(body.runId);

    if (!(await run.exists)) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    if (message === "/done") {
      // This route only resumes the chat-message hook. Approval hooks are
      // resumed exclusively by the signed Slack interactions endpoint.
      await chatMessageHook.resume(body.runId, { message });

      return createUIMessageStreamResponse({
        stream: finishOnlyStream(),
        headers: { "x-workflow-run-id": body.runId },
      });
    }

    // Snapshot the tail before resuming, so the new turn's chunks are not lost.
    const probe = run.getReadable<UIMessageChunk>();
    const tailIndex = await probe.getTailIndex();
    await probe.cancel();

    // This route only resumes the chat-message hook. Approval hooks are
    // resumed exclusively by the signed Slack interactions endpoint.
    await chatMessageHook.resume(body.runId, { message });

    const stream = sliceUntilFinish(
      run.getReadable<UIMessageChunk>({ startIndex: tailIndex + 1 })
    );

    return createUIMessageStreamResponse({
      stream,
      headers: { "x-workflow-run-id": body.runId },
    });
  }

  const wallet = loadWallet();

  if (!body.customerId || !findAccount(wallet, body.customerId)) {
    return Response.json({ error: "Unknown customer" }, { status: 400 });
  }

  const run = await start(chatWorkflow, [
    { customerId: body.customerId, initialMessage: message },
  ]);
  const stream = sliceUntilFinish(run.getReadable<UIMessageChunk>());

  return createUIMessageStreamResponse({
    stream,
    headers: { "x-workflow-run-id": run.runId },
  });
}

function lastUserText(messages: UIMessage[] | undefined): string | null {
  const last = messages?.at(-1);

  if (!last || last.role !== "user") return null;

  const text = last.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

function finishOnlyStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

function sliceUntilFinish(
  source: ReadableStream<UIMessageChunk>
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const reader = source.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          controller.enqueue(value);
          if (value.type === "finish") break;
        }

        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}
