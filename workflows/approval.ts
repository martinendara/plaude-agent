import type {
  ApprovalDecision,
  ApprovalRequest,
} from "@/lib/approval-types";
import { requestApproval } from "@/workflows/approval-request";

type ApprovalInput = {
  request: ApprovalRequest;
  timeoutMs: number;
};

export async function approvalWorkflow({
  request,
  timeoutMs,
}: ApprovalInput): Promise<ApprovalDecision> {
  "use workflow";

  return requestApproval({ request, timeoutMs });
}
