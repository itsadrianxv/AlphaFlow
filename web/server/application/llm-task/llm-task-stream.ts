import Redis from "ioredis";
import { env } from "~/env";

const streamName = process.env.LLM_TASK_STREAM ?? "llm:tasks";
let publisher: Redis | undefined;

function getPublisher() {
  publisher ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return publisher;
}

export type LlmTaskStreamMessage = {
  taskId: string;
  taskType: string;
  idempotencyKey: string;
  inputHash: string;
};

/**
 * 发布一次后台 LLM 唤醒。任务状态仍由 PostgreSQL 保存，重复 XADD 由 Worker claim 幂等收敛。
 */
export async function publishLlmTask(
  task: LlmTaskStreamMessage,
  streamPublisher: Pick<Redis, "xadd"> = getPublisher(),
) {
  const createdAt = new Date().toISOString();
  await streamPublisher.xadd(
    streamName,
    "*",
    "schemaVersion",
    "1",
    "taskId",
    task.taskId,
    "taskType",
    task.taskType,
    "idempotencyKey",
    task.idempotencyKey,
    "inputHash",
    task.inputHash,
    "createdAt",
    createdAt,
  );
  return { streamName, createdAt };
}
