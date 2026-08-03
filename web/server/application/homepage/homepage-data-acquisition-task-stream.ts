import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { env } from "~/env";

const streamName =
  process.env.DATA_ACQUISITION_STREAM ?? "homepage:data-acquisition";
let publisher: Redis | undefined;

export type HomepageDataAcquisitionPublisher = Pick<Redis, "xadd">;

function getPublisher() {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

export async function publishHomepageDataAcquisitionAttempt(
  attemptId: string,
  streamPublisher: HomepageDataAcquisitionPublisher = getPublisher(),
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
    attemptId,
    "createdAt",
    createdAt,
  );
  return { streamName, createdAt };
}
