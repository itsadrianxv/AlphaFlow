import { z } from "zod";
import { env } from "~/env";
import { ScheduledTaskEditService } from "~/server/application/scheduled-task/scheduled-task-edit-service";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import { db } from "~/server/db";

export const runtime = "nodejs";

const requestSchema = z.object({
  operation: z.enum([
    "list_schedule_capabilities",
    "inspect_schedule_capability",
    "validate_schedule",
    "resolve_user_scope",
    "build_scheduled_task_draft",
    "build_scheduled_task_edit_draft",
  ]),
  runId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

export async function POST(request: Request) {
  if (
    !env.ALPHAFLOW_INTERNAL_API_SECRET ||
    request.headers.get("X-Alphaflow-Internal-Secret") !==
      env.ALPHAFLOW_INTERNAL_API_SECRET
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "INVALID_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  const input = parsed.data;
  const run = await db.workflowRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: { input: true },
  });
  const runInput =
    run?.input && typeof run.input === "object" && !Array.isArray(run.input)
      ? (run.input as Record<string, unknown>)
      : {};
  const skillId = String(runInput.skillId ?? "");
  if (
    !run ||
    !["scheduled-task-setup", "scheduled-task-edit"].includes(skillId) ||
    runInput.conversationId !== input.conversationId
  ) {
    return Response.json({ error: "RUN_FORBIDDEN" }, { status: 403 });
  }
  const service = new ScheduledTaskSetupService(db);
  try {
    switch (input.operation) {
      case "list_schedule_capabilities":
        return Response.json(
          await service.listCapabilities({
            provider:
              typeof input.params.provider === "string"
                ? input.params.provider
                : undefined,
            query:
              typeof input.params.query === "string"
                ? input.params.query
                : undefined,
          }),
        );
      case "inspect_schedule_capability":
        return Response.json(
          await service.inspectCapability(
            String(input.params.capability ?? ""),
          ),
        );
      case "resolve_user_scope":
        return Response.json(await service.resolveUserScope(input.userId));
      case "validate_schedule":
        return Response.json(await service.validateDraft(input.params.draft));
      case "build_scheduled_task_draft":
        if (skillId !== "scheduled-task-setup")
          return Response.json(
            { error: "OPERATION_FORBIDDEN" },
            { status: 403 },
          );
        return Response.json(
          await service.buildDraft({
            userId: input.userId,
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey,
            value: input.params.validatedDraft,
          }),
        );
      case "build_scheduled_task_edit_draft": {
        if (skillId !== "scheduled-task-edit")
          return Response.json(
            { error: "OPERATION_FORBIDDEN" },
            { status: 403 },
          );
        const conversation = await db.agentConversation.findFirst({
          where: {
            id: input.conversationId,
            userId: input.userId,
            routingMode: "SCHEDULED_TASK_EDIT",
          },
          select: { activeScheduledTaskEditTaskId: true },
        });
        if (!conversation?.activeScheduledTaskEditTaskId)
          return Response.json(
            { error: "EDIT_CONTEXT_NOT_FOUND" },
            { status: 409 },
          );
        return Response.json(
          await new ScheduledTaskEditService(db).prepareAgent({
            userId: input.userId,
            taskId: conversation.activeScheduledTaskEditTaskId,
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey,
            value: input.params.validatedDraft,
          }),
        );
      }
    }
  } catch (error) {
    return Response.json(
      {
        error: "TOOL_FAILED",
        message: error instanceof Error ? error.message : "定时任务工具失败",
      },
      { status: 400 },
    );
  }
}
