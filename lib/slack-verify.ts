import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function isValidSlackRequest({
  rawBody,
  timestamp,
  signature,
  signingSecret,
}: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string;
}): boolean {
  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const expectedSignature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;

  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(signature, "utf8");

  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
