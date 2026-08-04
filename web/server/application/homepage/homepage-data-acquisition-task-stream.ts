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
  const enqueuedAt = new Date().toISOString();
  await streamPublisher.xadd(
    streamName,
    "*",
    "schemaVersion",
    "1",
    "executionId",
    attemptId,
    "enqueuedAt",
    enqueuedAt,
  );
  return { streamName, createdAt: enqueuedAt };
}
