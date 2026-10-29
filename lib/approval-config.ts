import type { ApprovalRequest } from "@/lib/approval-types";

export const APPROVAL_REQUEST: ApprovalRequest = {
  summary:
    "Reverse transfer TX-1042, USD 250, customer says it went to the wrong person.",
};

// Change this single value to adjust how long an approval stays open.
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
