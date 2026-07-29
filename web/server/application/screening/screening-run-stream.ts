import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { env } from "~/env";

const streamName = process.env.SCREENING_RUN_STREAM ?? "screening:runs";
let publisher: Redis | undefined;

function getPublisher() {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

type StreamPublisher = Pick<Redis, "xadd">;

export async function publishScreeningRun(
  runId: string,
  streamPublisher: StreamPublisher = getPublisher(),
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
    runId,
    "createdAt",
    createdAt,
  );
  return { streamName, createdAt };
}
