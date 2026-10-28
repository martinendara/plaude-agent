import { start } from "workflow/api";

import { helloWorkflow } from "@/workflows/hello";

export async function POST() {
  const run = await start(helloWorkflow);
  const message = await run.returnValue;

  return Response.json({ runId: run.runId, message });
}
