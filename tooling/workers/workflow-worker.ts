import { randomUUID } from "node:crypto";
import { env } from "~/env";
import { createWorkflowExecutionService } from "~/server/application/workflow/execution-service";
import { db } from "~/server/db";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

const repository = new PrismaWorkflowRunRepository(db);
const executionService = createWorkflowExecutionService(repository);

const workerId = process.env.WORKFLOW_WORKER_ID ?? `workflow-worker-${randomUUID()}`;
const pollIntervalMs = env.WORKFLOW_WORKER_POLL_INTERVAL_MS;

let shuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info(`[workflow-worker] receive ${signal}, shutting down...`);

  await db.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main() {
  console.info(`[workflow-worker] started: ${workerId}`);

  while (!shuttingDown) {
    try {
      const recovered = await executionService.executeRecoverableRunningRun(workerId);

      if (recovered) {
        continue;
      }

      const picked = await executionService.executeNextPendingRun(workerId);

      if (!picked) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[workflow-worker] loop error: ${message}`);
      await sleep(pollIntervalMs);
    }
  }
}

void main();
