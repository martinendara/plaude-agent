import { getRun } from "workflow/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getRun(runId);

  if (!(await run.exists)) {
    return Response.json({ status: "not_found" }, { status: 404 });
  }

  const status = await run.status;

  if (status === "completed") {
    return Response.json({ status, result: await run.returnValue });
  }

  return Response.json({ status });
}
