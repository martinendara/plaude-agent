import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessageChunk } from "ai";
import { getWritable, getWorkflowMetadata } from "workflow";

import { AGENT_INSTRUCTIONS } from "@/lib/agent-instructions";
import { friendlyAgentError } from "@/lib/model-errors";
import { getModel, MODEL_PROVIDER_OPTIONS } from "@/lib/model";
import { findAccount, loadWallet } from "@/lib/wallet";
import {
  createAgentTools,
  type SessionState,
} from "@/workflows/agent-tools";
import { chatMessageHook } from "@/workflows/chat-hooks";
import { writeFallbackMessage } from "@/workflows/wallet-steps";

export type ChatInput = {
  customerId: string;
  initialMessage: string;
};

export type ChatResult = {
  turns: number;
};

export async function chatWorkflow({
  customerId,
  initialMessage,
}: ChatInput): Promise<ChatResult> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const hook = chatMessageHook.create({ token: workflowRunId });
  const conflict = await hook.getConflict();

  if (conflict) {
    throw new Error("Chat hook token is already in use");
  }

  const wallet = loadWallet();
  const account = findAccount(wallet, customerId);

  if (!account) throw new Error("Unknown customer");

  const state: SessionState = {
    wallet,
    actionQueue: Promise.resolve(),
  };
  const tools = createAgentTools({
    state,
    customerId,
    customerName: account.name,
  });
  const agent = new DurableAgent({
    model: getModel,
    tools,
    instructions: AGENT_INSTRUCTIONS,
    providerOptions: MODEL_PROVIDER_OPTIONS,
  });
  const writable = getWritable<UIMessageChunk>();
  const maxTurns = 40;

  let messages: ModelMessage[] = [];
  let turn = 0;
  let nextMessage: string | null = initialMessage;

  while (nextMessage !== null && turn < maxTurns) {
    messages.push({ role: "user", content: nextMessage });
    turn += 1;

    try {
      const result = await agent.stream({
        messages,
        writable,
        preventClose: true,
        sendFinish: true,
        maxSteps: 8,
      });

      messages = result.messages;
    } catch (error) {
      console.error("Agent turn failed", error);
      const fallback = friendlyAgentError(error);
      await writeFallbackMessage(writable, fallback);
      messages.push({ role: "assistant", content: fallback });
    }

    if (turn >= maxTurns) break;

    const incoming = await hook;

    if (incoming.message.trim() === "/done") break;

    nextMessage = incoming.message;
  }

  return { turns: turn };
}
