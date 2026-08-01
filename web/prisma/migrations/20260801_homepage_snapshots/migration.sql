CREATE TYPE "HomePageSnapshotScope" AS ENUM ('DEFAULT', 'PERSONALIZED');
CREATE TYPE "HomePageGenerationTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "HomePageGenerationTask" (
    "id" TEXT NOT NULL,
    "generationKey" TEXT NOT NULL,
    "scope" "HomePageSnapshotScope" NOT NULL,
    "userId" TEXT,
    "preferenceFingerprint" TEXT,
    "baselineDefaultSnapshotId" TEXT,
    "selectionJson" JSONB NOT NULL DEFAULT '{}',
    "triggerReason" TEXT NOT NULL,
    "targetTradeDate" TEXT NOT NULL,
    "status" "HomePageGenerationTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "eventPublishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomePageGenerationTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomePageSnapshot" (
    "id" TEXT NOT NULL,
    "scope" "HomePageSnapshotScope" NOT NULL,
    "userId" TEXT,
    "preferenceFingerprint" TEXT,
    "baselineDefaultSnapshotId" TEXT,
    "payload" JSONB NOT NULL,
    "dataAsOf" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generationTaskId" TEXT NOT NULL,
    CONSTRAINT "HomePageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomePageGenerationTask_generationKey_key" ON "HomePageGenerationTask"("generationKey");
CREATE INDEX "HomePageGenerationTask_status_nextAttemptAt_idx" ON "HomePageGenerationTask"("status", "nextAttemptAt");
CREATE INDEX "HomePageGenerationTask_status_leaseExpiresAt_idx" ON "HomePageGenerationTask"("status", "leaseExpiresAt");
CREATE INDEX "HomePageGenerationTask_eventPublishedAt_status_idx" ON "HomePageGenerationTask"("eventPublishedAt", "status");
CREATE INDEX "HomePageGenerationTask_userId_createdAt_idx" ON "HomePageGenerationTask"("userId", "createdAt");
CREATE UNIQUE INDEX "HomePageSnapshot_generationTaskId_key" ON "HomePageSnapshot"("generationTaskId");
CREATE INDEX "HomePageSnapshot_scope_generatedAt_idx" ON "HomePageSnapshot"("scope", "generatedAt");
CREATE INDEX "HomePageSnapshot_userId_preferenceFingerprint_generatedAt_idx" ON "HomePageSnapshot"("userId", "preferenceFingerprint", "generatedAt");
CREATE INDEX "HomePageSnapshot_baselineDefaultSnapshotId_idx" ON "HomePageSnapshot"("baselineDefaultSnapshotId");

ALTER TABLE "HomePageGenerationTask" ADD CONSTRAINT "HomePageGenerationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomePageSnapshot" ADD CONSTRAINT "HomePageSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomePageSnapshot" ADD CONSTRAINT "HomePageSnapshot_generationTaskId_fkey" FOREIGN KEY ("generationTaskId") REFERENCES "HomePageGenerationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
