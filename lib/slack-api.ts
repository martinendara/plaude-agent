import { FatalError } from "workflow";

type SlackResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

type SlackMembersResponse = {
  ok: boolean;
  error?: string;
  members?: string[];
  response_metadata?: { next_cursor?: string };
};

// Slack requires an ack within 3 seconds. This leaves room for the
// not-authorized message before the interactions route responds.
const SLACK_MEMBERS_TIMEOUT_MS = 1_500;

export async function callSlack(
  method: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {}
): Promise<SlackResponse> {
  const botToken = requireEnv("SLACK_BOT_TOKEN");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal:
      options.timeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(options.timeoutMs),
  });

  const data = (await response.json()) as SlackResponse;

  if (!data.ok) {
    throw new FatalError(
      `Slack ${method} failed: ${data.error ?? "unknown_error"}`
    );
  }

  return data;
}

export async function isSlackChannelMember(
  userId: string,
  channelId: string
): Promise<boolean> {
  const botToken = requireEnv("SLACK_BOT_TOKEN");
  const response = await fetch("https://slack.com/api/conversations.members", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ channel: channelId, limit: "1000" }),
    signal: AbortSignal.timeout(SLACK_MEMBERS_TIMEOUT_MS),
    cache: "no-store",
  });

  const data = (await response.json()) as SlackMembersResponse;

  if (!data.ok || !data.members) {
    throw new Error(
      `Slack conversations.members failed: ${data.error ?? "unknown_error"}`
    );
  }

  // More than one page: do not guess inside the ack budget. Fail closed.
  if (data.response_metadata?.next_cursor) {
    throw new Error("Slack conversations.members returned more than one page");
  }

  return data.members.includes(userId);
}

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new FatalError(`Missing environment variable: ${name}`);

  return value;
}
