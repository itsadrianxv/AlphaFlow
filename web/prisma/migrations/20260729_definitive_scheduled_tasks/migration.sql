ALTER TABLE "ScheduledTaskExecution"
ADD COLUMN "fencingToken" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "ScheduledTaskExecution_status_leaseExpiresAt_idx"
ON "ScheduledTaskExecution"("status", "leaseExpiresAt");
CREATE INDEX "ScheduledTaskExecution_status_nextAttemptAt_idx"
ON "ScheduledTaskExecution"("status", "nextAttemptAt");

CREATE TABLE "ScheduledTaskScoreResult" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "evaluationStatus" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "ruleResults" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledTaskScoreResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledTaskScoreResult_executionId_stockCode_key"
ON "ScheduledTaskScoreResult"("executionId", "stockCode");
CREATE UNIQUE INDEX "ScheduledTaskScoreResult_executionId_rank_key"
ON "ScheduledTaskScoreResult"("executionId", "rank");
CREATE INDEX "ScheduledTaskScoreResult_executionId_selected_rank_idx"
ON "ScheduledTaskScoreResult"("executionId", "selected", "rank");

ALTER TABLE "ScheduledTaskScoreResult"
ADD CONSTRAINT "ScheduledTaskScoreResult_executionId_fkey"
FOREIGN KEY ("executionId") REFERENCES "ScheduledTaskExecution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
