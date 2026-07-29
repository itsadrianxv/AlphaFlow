CREATE TYPE "ScreeningRunStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

ALTER TABLE "ScreeningWorkspace"
ADD COLUMN "universe" JSONB NOT NULL DEFAULT '{"type":"STOCKS","stockCodes":[]}';

CREATE TABLE "ScreeningRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "ScreeningRunStatus" NOT NULL DEFAULT 'PENDING',
  "config" JSONB NOT NULL,
  "universeCount" INTEGER,
  "totalCount" INTEGER,
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "diagnostics" JSONB NOT NULL DEFAULT '{}',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScreeningRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScreeningRunResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "stockCode" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  CONSTRAINT "ScreeningRunResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScreeningRun_workspaceId_createdAt_idx" ON "ScreeningRun"("workspaceId", "createdAt");
CREATE INDEX "ScreeningRun_userId_createdAt_idx" ON "ScreeningRun"("userId", "createdAt");
CREATE INDEX "ScreeningRun_status_leaseExpiresAt_idx" ON "ScreeningRun"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "ScreeningRunResult_runId_stockCode_key" ON "ScreeningRunResult"("runId", "stockCode");
CREATE UNIQUE INDEX "ScreeningRunResult_runId_rank_key" ON "ScreeningRunResult"("runId", "rank");
CREATE INDEX "ScreeningRunResult_runId_rank_idx" ON "ScreeningRunResult"("runId", "rank");
ALTER TABLE "ScreeningRun" ADD CONSTRAINT "ScreeningRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ScreeningWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreeningRun" ADD CONSTRAINT "ScreeningRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreeningRunResult" ADD CONSTRAINT "ScreeningRunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScreeningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
