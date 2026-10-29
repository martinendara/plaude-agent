import { FatalError } from "workflow";

type SlackResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

export async function callSlack(
  method: string,
  body: Record<string, unknown>
): Promise<SlackResponse> {
  const botToken = requireEnv("SLACK_BOT_TOKEN");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as SlackResponse;

  if (!data.ok) {
    throw new FatalError(
      `Slack ${method} failed: ${data.error ?? "unknown_error"}`
    );
  }

  return data;
}

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new FatalError(`Missing environment variable: ${name}`);

  return value;
}
