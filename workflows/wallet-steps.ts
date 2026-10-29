import type { UIMessageChunk } from "ai";

import {
  applyMutation,
  type Wallet,
  type WalletMutation,
} from "@/lib/wallet";

export async function applyWalletMutation(
  wallet: Wallet,
  mutation: WalletMutation
): Promise<Wallet> {
  "use step";

  return applyMutation(wallet, mutation);
}

export async function writeFallbackMessage(
  writable: WritableStream<UIMessageChunk>,
  text: string
): Promise<void> {
  "use step";

  const writer = writable.getWriter();
  const id = crypto.randomUUID();

  try {
    await writer.write({ type: "text-start", id });
    await writer.write({ type: "text-delta", id, delta: text });
    await writer.write({ type: "text-end", id });
    await writer.write({ type: "finish" });
  } finally {
    writer.releaseLock();
  }
}
