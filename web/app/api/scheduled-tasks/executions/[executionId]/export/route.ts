import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { buildScoringWorkbook } from "~/server/application/scheduled-task/scoring-excel-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ executionId: string }> };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { executionId } = await context.params;
  const execution = await db.scheduledTaskExecution.findFirst({
    where: {
      id: executionId,
      status: "SUCCEEDED",
      task: { userId: session.user.id },
    },
    include: {
      task: { select: { name: true } },
      scoreResults: { orderBy: { rank: "asc" } },
    },
  });
  const summary = asRecord(execution?.result);
  if (!execution || summary.type !== "SCORING_REPORT")
    return new Response("Not Found", { status: 404 });
  const rules = Array.isArray(summary.rules)
    ? summary.rules.map((value) => {
        const item = asRecord(value);
        return {
          id: String(item.id ?? ""),
          name: String(item.name ?? item.id ?? ""),
          points: Number(item.points ?? 0),
          condition: item.condition,
        };
      })
    : [];
  const buffer = await buildScoringWorkbook({
    taskName: execution.task.name,
    executionId: execution.id,
    scheduledAt: execution.scheduledAt,
    summary,
    rules,
    rows: execution.scoreResults,
  });
  const fileName = encodeURIComponent(`${execution.task.name}-${String(summary.asOfDate ?? execution.id)}.xlsx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${fileName}`,
      "cache-control": "private, no-store",
    },
  });
}
