export type MembershipLookup = (
  userId: string,
  channelId: string
) => Promise<boolean>;

export type ApproverRefusalReason =
  | "unknown-user"
  | "no-approvals-channel"
  | "not-a-member"
  | "channel-check-failed";

export type ApproverDecision =
  | { authorized: true }
  | { authorized: false; reason: ApproverRefusalReason };

export function parseApproverIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function isAuthorizedApprover(
  userId: string | undefined,
  allowedIds: string[]
): boolean {
  return userId !== undefined && allowedIds.includes(userId);
}

export async function authorizeApprover({
  userId,
  allowedIds,
  channelId,
  isChannelMember,
}: {
  userId: string | undefined;
  allowedIds: string[];
  channelId: string | undefined;
  isChannelMember: MembershipLookup;
}): Promise<ApproverDecision> {
  if (isAuthorizedApprover(userId, allowedIds)) {
    return { authorized: true };
  }

  if (userId === undefined) {
    return { authorized: false, reason: "unknown-user" };
  }

  if (!channelId) {
    return { authorized: false, reason: "no-approvals-channel" };
  }

  // Fail closed: an unreachable or slow Slack API never grants a decision.
  try {
    const isMember = await isChannelMember(userId, channelId);

    return isMember
      ? { authorized: true }
      : { authorized: false, reason: "not-a-member" };
  } catch {
    return { authorized: false, reason: "channel-check-failed" };
  }
}
