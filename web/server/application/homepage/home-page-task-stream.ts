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
  const enqueuedAt = new Date().toISOString();
  await streamPublisher.xadd(
    streamName,
    "*",
    "schemaVersion",
    "1",
    "executionId",
    taskId,
    "enqueuedAt",
    enqueuedAt,
  );
  return { streamName, createdAt: enqueuedAt };
}
