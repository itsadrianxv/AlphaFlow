import type { WorkflowEventStreamType } from "~/modules/research/server/domain/workflow/types";
import { PrismaWorkflowRunRepository } from "~/modules/research/server/infrastructure/workflow/prisma/workflow-run-repository";
import { db } from "~/platform/db";
import { RedisWorkflowRuntimeStore } from "~/platform/workflow-runtime/redis/redis-workflow-runtime-store";
import { auth } from "~/server/auth";

type ResearchRunEventsRouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

function mapEventType(eventType: string): WorkflowEventStreamType | null {
  const mapping: Record<string, WorkflowEventStreamType> = {
    RUN_STARTED: "RUN_STARTED",
    RUN_PAUSED: "RUN_PAUSED",
    RUN_RESUMED: "RUN_RESUMED",
    NODE_STARTED: "NODE_STARTED",
    NODE_PROGRESS: "NODE_PROGRESS",
    NODE_SUCCEEDED: "NODE_SUCCEEDED",
    NODE_FAILED: "NODE_FAILED",
    RUN_SUCCEEDED: "RUN_SUCCEEDED",
    RUN_FAILED: "RUN_FAILED",
    RUN_CANCELLED: "RUN_CANCELLED",
  };

  return mapping[eventType] ?? null;
}

function createSseDataChunk(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function handleResearchRunEventsRequest(
  request: Request,
  context: ResearchRunEventsRouteContext,
) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runId } = await context.params;
  const repository = new PrismaWorkflowRunRepository(db);
  const run = await repository.getRunDetailForUser(runId, session.user.id);

  if (!run) {
    return new Response("Not Found", { status: 404 });
  }

  const runtimeStore = new RedisWorkflowRuntimeStore();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          createSseDataChunk({
            runId,
            sequence: 0,
            type: "RUN_STARTED",
            progressPercent: run.progressPercent,
            timestamp: new Date().toISOString(),
            payload: {
              connected: true,
              status: run.status,
            },
          }),
        ),
      );

      for (const event of run.events) {
        const type = mapEventType(event.eventType);
        if (!type) {
          continue;
        }

        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const payloadNodeKey =
          typeof payload.nodeKey === "string" ? payload.nodeKey : undefined;

        controller.enqueue(
          encoder.encode(
            createSseDataChunk({
              runId,
              sequence: event.sequence,
              type,
              nodeKey: payloadNodeKey,
              progressPercent: run.progressPercent,
              timestamp: event.occurredAt.toISOString(),
              payload,
            }),
          ),
        );
      }

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, 15_000);

      const unsubscribe = await runtimeStore.subscribeToRunEvents(
        runId,
        (event) => {
          controller.enqueue(encoder.encode(createSseDataChunk(event)));
        },
        request.signal,
      );

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        void unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
