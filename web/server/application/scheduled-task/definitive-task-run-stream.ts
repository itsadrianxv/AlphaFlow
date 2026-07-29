import Redis from "ioredis";
import { env } from "~/env";

const streamName =
  process.env.DEFINITIVE_TASK_RUN_STREAM ?? "definitive-task:runs";
let publisher: Redis | undefined;

function getPublisher() {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

type StreamPublisher = Pick<Redis, "xadd">;

export async function publishDefinitiveTaskRun(
  executionId: string,
  streamPublisher: StreamPublisher = getPublisher(),
) {
  const enqueuedAt = new Date().toISOString();
  await streamPublisher.xadd(
    streamName,
    "*",
    "schemaVersion",
    "1",
    "executionId",
    executionId,
    "enqueuedAt",
    enqueuedAt,
  );
  return { streamName, enqueuedAt };
}
