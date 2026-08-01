CREATE TYPE "HomePageSnapshotScope" AS ENUM ('DEFAULT', 'PERSONALIZED');
CREATE TYPE "HomePageGenerationTaskStatus" AS ENUM ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED');
CREATE TABLE "HomePageGenerationTask" (
  id TEXT PRIMARY KEY, "generationKey" TEXT UNIQUE NOT NULL, scope "HomePageSnapshotScope" NOT NULL,
  "userId" TEXT, "preferenceFingerprint" TEXT, "baselineDefaultSnapshotId" TEXT,
  "selectionJson" JSONB NOT NULL DEFAULT '{}'::jsonb, "triggerReason" TEXT NOT NULL DEFAULT 'test',
  "targetTradeDate" TEXT NOT NULL DEFAULT '2026-08-01', status "HomePageGenerationTaskStatus" NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0, "workerId" TEXT, "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ, "heartbeatAt" TIMESTAMPTZ, "nextAttemptAt" TIMESTAMPTZ,
  "eventPublishedAt" TIMESTAMPTZ, "errorCode" TEXT, "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ, "completedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE "HomePageSnapshot" (
  id TEXT PRIMARY KEY, scope "HomePageSnapshotScope" NOT NULL, "userId" TEXT,
  "preferenceFingerprint" TEXT, "baselineDefaultSnapshotId" TEXT, payload JSONB NOT NULL,
  "dataAsOf" TEXT NOT NULL, "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "generationTaskId" TEXT UNIQUE NOT NULL REFERENCES "HomePageGenerationTask"(id)
);
