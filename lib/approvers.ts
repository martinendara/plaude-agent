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
