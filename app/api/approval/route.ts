import { start } from "workflow/api";

import {
  APPROVAL_REQUEST,
  APPROVAL_TIMEOUT_MS,
} from "@/lib/approval-config";
import { approvalWorkflow } from "@/workflows/approval";

export async function POST() {
  const run = await start(approvalWorkflow, [
    { request: APPROVAL_REQUEST, timeoutMs: APPROVAL_TIMEOUT_MS },
  ]);

  return Response.json({ runId: run.runId });
}
