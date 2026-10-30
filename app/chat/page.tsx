"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@workflow/ai";
import type { UIMessage } from "ai";
import {
  useEffect,
  useSyncExternalStore,
  useState,
  type FormEvent,
} from "react";

const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function useMounted() {
  return useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot
  );
}

const CUSTOMERS = [
  { id: "cus_ana", label: "Ana Torres - fraud lock" },
  { id: "cus_bruno", label: "Bruno Silva - lost card" },
  { id: "cus_diego", label: "Diego Torres" },
] as const;

export default function ChatPage() {
  const [conversationKey, setConversationKey] = useState(0);
  const mounted = useMounted();

  if (!mounted) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-zinc-50 px-4 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
        Loading chat...
      </main>
    );
  }

  return (
    <Chat
      key={conversationKey}
      onNewConversation={() => setConversationKey((key) => key + 1)}
    />
  );
}

function Chat({ onNewConversation }: { onNewConversation: () => void }) {
  const [customerId, setCustomerId] = useState<string>("cus_ana");
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [transport] = useState(
    () =>
      new WorkflowChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages },
        }),
        onChatSendMessage: (response) => {
          const id = response.headers.get("x-workflow-run-id");
          if (id) setRunId(id);
        },
      })
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (error) console.error("Chat connection error", error);
  }, [error]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    void sendMessage(
      { text },
      { body: { runId, customerId: runId ? undefined : customerId } }
    );
  }

  function newConversation() {
    if (runId) {
      void fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          messages: [
            {
              id: crypto.randomUUID(),
              role: "user",
              parts: [{ type: "text", text: "/done" }],
            },
          ],
        }),
      }).catch(() => undefined);
    }

    onNewConversation();
  }

  return (
    <main className="min-h-svh bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Acme Wallet
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Support chat
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {runId && (
              <a
                href={`/operator/${runId}`}
                className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-300"
              >
                View timeline
              </a>
            )}
            <button
              type="button"
              onClick={newConversation}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              New conversation
            </button>
          </div>
        </header>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Demo customer</span>
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            disabled={messages.length > 0}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {CUSTOMERS.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              The customer is fixed once the conversation starts.
            </span>
          )}
        </label>

        <div
          aria-live="polite"
          className="flex min-h-80 flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {messages.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ask about a balance, a fee, a transfer or an account lock.
            </p>
          )}

          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}

          {busy && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Working on it. Some actions need a human review.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              The connection was interrupted. Your request is still being
              processed.
            </p>
          )}
        </div>

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type a message..."
            aria-label="Message"
            disabled={busy}
            className="h-11 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="h-11 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

function Message({ message }: { message: UIMessage }) {
  const text = message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text"
    )
    .map((part) => part.text)
    .join("");

  if (!text) return null;

  const isUser = message.role === "user";

  return (
    <div className={isUser ? "self-end text-right" : "self-start"}>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {isUser ? "Customer" : "Acme agent"}
      </p>
      <p
        className={
          isUser
            ? "mt-1 inline-block whitespace-pre-wrap break-words rounded-xl bg-zinc-900 px-4 py-2 text-left text-sm text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "mt-1 whitespace-pre-wrap break-words text-sm leading-6"
        }
      >
        {text}
      </p>
    </div>
  );
}
