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
  const body = await request.json().catch(() => ({}));
  if (
    body?.contractVersion !== "1.0" ||
    body?.taskId !== taskId ||
    typeof body?.workerId !== "string" ||
    typeof body?.fencingToken !== "string"
  ) {
    return Response.json(
      {
        kind: "terminal_failure",
        errorCode: "CONTRACT_INCOMPATIBLE",
        details: { message: "首页生成请求信封不兼容" },
      },
      { status: 400 },
    );
  }
  try {
    const result = await runHomepageGeneration(db, {
      taskId,
      workerId: body.workerId,
      fencingToken: body.fencingToken,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        kind: "retryable_failure",
        errorCode: "DEPENDENCY_UNAVAILABLE",
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 502 },
    );
  }
}
