import { env } from "~/env";
import { HomePagePayloadGenerator } from "~/server/application/homepage/home-page-payload-generator";
import { resolveHomePageSelection } from "~/server/application/homepage/home-page-selection";
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
  const task = await db.homePageGenerationTask.findUnique({
    where: { id: taskId },
  });
  if (!task) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (task.status !== "RUNNING") {
    return Response.json({ error: "TASK_NOT_RUNNING" }, { status: 409 });
  }
  if (task.scope === "PERSONALIZED" && task.userId) {
    const current = await resolveHomePageSelection(db, task.userId);
    if (current.fingerprint !== task.preferenceFingerprint) {
      return Response.json({ error: "STALE_PREFERENCE" }, { status: 409 });
    }
  }
  try {
    return Response.json(
      await new HomePagePayloadGenerator().generate({
        selectionJson: task.selectionJson,
      }),
    );
  } catch (error) {
    return Response.json(
      {
        error: "GENERATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
