CREATE TYPE "ScreeningRunStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

CREATE TABLE "ScreeningRun" (
  id TEXT PRIMARY KEY,
  status "ScreeningRunStatus" NOT NULL DEFAULT 'PENDING',
  config JSONB NOT NULL,
  "universeCount" INTEGER,
  "totalCount" INTEGER,
  warnings JSONB NOT NULL DEFAULT '[]',
  diagnostics JSONB NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "nextAttemptAt" TIMESTAMPTZ,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "ScreeningRunResult" (
  id TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "ScreeningRun"(id) ON DELETE CASCADE,
  "stockCode" TEXT NOT NULL,
  rank INTEGER NOT NULL,
  UNIQUE ("runId", "stockCode"),
  UNIQUE ("runId", rank)
);
