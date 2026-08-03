import { env } from "~/env";
import { runHomepageGeneration } from "~/server/application/homepage/home-page-generation";
import { db } from "~/server/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  if (
    !env.ALPHAFLOW_INTERNAL_API_SECRET ||
    request.headers.get("X-Alphaflow-Internal-Secret") !==
      env.ALPHAFLOW_INTERNAL_API_SECRET
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { taskId } = await context.params;
  const task = await db.homepageGenerationTask.findUnique({
    where: { id: taskId },
    select: { status: true, workerId: true, fencingToken: true },
  });
  if (!task) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (task.status !== "RUNNING" || !task.workerId) {
    return Response.json({ error: "TASK_NOT_RUNNING" }, { status: 409 });
  }
  const result = await runHomepageGeneration(db, {
    taskId,
    workerId: task.workerId,
    fencingToken: task.fencingToken.toString(),
  });
  if (result.kind === "generated") {
    return Response.json({
      payload: result.payload,
      dataAsOf: result.payload.heatmap.tradeDate,
    });
  }
  if (result.kind === "obsolete") {
    return Response.json({ error: "TASK_NOT_RUNNING" }, { status: 409 });
  }
  if (result.kind === "retryable_failure") {
    return Response.json(
      { error: result.errorCode, details: result.details },
      { status: 503 },
    );
  }
  if (result.kind === "terminal_failure") {
    return Response.json(
      { error: result.errorCode, details: result.details },
      { status: 422 },
    );
  }
}
