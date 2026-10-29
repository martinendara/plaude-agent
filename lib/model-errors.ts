import { APICallError } from "ai";

export function isRateLimitError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    return error.statusCode === 429;
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      statusCode?: unknown;
      code?: unknown;
      data?: { error?: { code?: unknown } };
    };

    return (
      candidate.statusCode === 429 ||
      candidate.code === "rate_limit_exceeded" ||
      candidate.data?.error?.code === 429
    );
  }

  return false;
}

export function friendlyAgentError(error: unknown): string {
  return isRateLimitError(error)
    ? "I'm getting a lot of requests right now. Please try again in a minute."
    : "Something went wrong on my side. Please try again.";
}
