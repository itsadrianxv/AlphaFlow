CREATE TYPE "LlmTaskExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "LlmTaskExecution" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL DEFAULT '{}',
    "status" "LlmTaskExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "eventPublishedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LlmTaskExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LlmTaskExecution_idempotencyKey_key" ON "LlmTaskExecution"("idempotencyKey");
CREATE INDEX "LlmTaskExecution_status_nextAttemptAt_idx" ON "LlmTaskExecution"("status", "nextAttemptAt");
CREATE INDEX "LlmTaskExecution_status_leaseExpiresAt_idx" ON "LlmTaskExecution"("status", "leaseExpiresAt");
CREATE INDEX "LlmTaskExecution_eventPublishedAt_status_idx" ON "LlmTaskExecution"("eventPublishedAt", "status");
