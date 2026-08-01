CREATE TYPE "ScheduledTaskExecutionStatus" AS ENUM (
  'PENDING', 'SUBMITTED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

CREATE TABLE "ScheduledTask" (
  id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'
);

CREATE TABLE "ScheduledTaskVersion" (
  id TEXT PRIMARY KEY,
  "executionPlan" JSONB NOT NULL
);

CREATE TABLE "ScheduledTaskExecution" (
  id TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "ScheduledTask"(id),
  "taskVersionId" TEXT NOT NULL REFERENCES "ScheduledTaskVersion"(id),
  "scheduledAt" TIMESTAMPTZ NOT NULL,
  status "ScheduledTaskExecutionStatus" NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "nextAttemptAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  result JSONB,
  error JSONB,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "ScheduledTaskScoreResult" (
  id TEXT PRIMARY KEY,
  "executionId" TEXT NOT NULL REFERENCES "ScheduledTaskExecution"(id) ON DELETE CASCADE,
  "stockCode" TEXT NOT NULL,
  "stockName" TEXT NOT NULL,
  rank INTEGER NOT NULL,
  selected BOOLEAN NOT NULL,
  "evaluationStatus" TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  "maxScore" DOUBLE PRECISION NOT NULL,
  "ruleResults" JSONB NOT NULL,
  UNIQUE ("executionId", "stockCode"),
  UNIQUE ("executionId", rank)
);
