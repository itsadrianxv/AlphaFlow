import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { env } from "~/env";

const streamName = process.env.HOMEPAGE_TASK_STREAM ?? "homepage:generation";
let publisher: Redis | undefined;

function getPublisher() {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

export async function publishHomePageGenerationTask(
  taskId: string,
  streamPublisher: Pick<Redis, "xadd"> = getPublisher(),
) {
  const createdAt = new Date().toISOString();
  await streamPublisher.xadd(
    streamName,
    "*",
    "schemaVersion",
    "1",
    "eventId",
    randomUUID(),
    "runId",
    taskId,
    "createdAt",
    createdAt,
  );
  return { streamName, createdAt };
}
