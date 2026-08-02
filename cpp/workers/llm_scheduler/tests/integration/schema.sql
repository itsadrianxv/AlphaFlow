CREATE TYPE "LlmTaskExecutionStatus" AS ENUM ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED');

CREATE TABLE "LlmTaskExecution" (
  id TEXT PRIMARY KEY,
  "taskType" TEXT NOT NULL,
  "idempotencyKey" TEXT UNIQUE NOT NULL,
  "inputHash" TEXT NOT NULL,
  "inputJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  status "LlmTaskExecutionStatus" NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "nextAttemptAt" TIMESTAMPTZ,
  "eventPublishedAt" TIMESTAMPTZ,
  result JSONB,
  error JSONB,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "LlmTaskExecution_status_nextAttemptAt_idx"
  ON "LlmTaskExecution" (status, "nextAttemptAt");
CREATE INDEX "LlmTaskExecution_status_leaseExpiresAt_idx"
  ON "LlmTaskExecution" (status, "leaseExpiresAt");
CREATE INDEX "LlmTaskExecution_eventPublishedAt_status_idx"
  ON "LlmTaskExecution" ("eventPublishedAt", status);
