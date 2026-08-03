CREATE TABLE "HomepageDataManifest" (
  id TEXT PRIMARY KEY,
  "manifestKey" TEXT UNIQUE NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL DEFAULT 'jcs-1',
  scope TEXT NOT NULL CHECK (scope IN ('BASELINE','PERSONALIZED')),
  "definitionVersion" TEXT NOT NULL DEFAULT 'definition-v1',
  "targetContextKey" TEXT NOT NULL DEFAULT 'trade-date:20260801',
  "targetContextJson" JSONB NOT NULL DEFAULT '{}',
  "activationSequence" BIGINT UNIQUE NOT NULL,
  "userId" TEXT,
  "baseManifestId" TEXT REFERENCES "HomepageDataManifest"(id) ON DELETE RESTRICT,
  "gateStatus" TEXT NOT NULL DEFAULT 'READY',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageGenerationTask" (
  id TEXT PRIMARY KEY,
  "generationKey" TEXT UNIQUE NOT NULL,
  "manifestId" TEXT UNIQUE NOT NULL REFERENCES "HomepageDataManifest"(id) ON DELETE RESTRICT,
  "activationSequence" BIGINT NOT NULL,
  "generationInputContractVersion" TEXT NOT NULL DEFAULT '1.0',
  "generatorDefinitionVersion" TEXT NOT NULL DEFAULT '1.0',
  "payloadSchemaVersion" TEXT NOT NULL DEFAULT '1.0',
  "promotionMode" TEXT NOT NULL DEFAULT 'PROMOTABLE',
  "schedulingTier" TEXT NOT NULL DEFAULT 'TIME_CRITICAL',
  "resourcePoolKey" TEXT NOT NULL DEFAULT 'homepage-generation',
  "fairnessKey" TEXT NOT NULL DEFAULT 'baseline',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "nextAttemptAt" TIMESTAMPTZ,
  "eventPublishedAt" TIMESTAMPTZ,
  "inputHash" TEXT,
  "errorCode" TEXT,
  "errorDetailsJson" JSONB,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageSnapshot" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL REFERENCES "HomepageDataManifest"(id) ON DELETE RESTRICT,
  "generationTaskId" TEXT UNIQUE NOT NULL REFERENCES "HomepageGenerationTask"(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('BASELINE','PERSONALIZED')),
  "userId" TEXT,
  "activationSequence" BIGINT NOT NULL,
  "generationInputContractVersion" TEXT NOT NULL,
  "generatorDefinitionVersion" TEXT NOT NULL,
  "payloadSchemaVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "dataCoverageJson" JSONB NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageCurrentSnapshotProjection" (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('BASELINE','PERSONALIZED')),
  "userId" TEXT,
  "snapshotId" TEXT NOT NULL REFERENCES "HomepageSnapshot"(id) ON DELETE RESTRICT,
  "activationSequence" BIGINT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "HomepageCurrentSnapshotProjection_baseline_unique"
  ON "HomepageCurrentSnapshotProjection" (scope)
  WHERE "userId" IS NULL;

CREATE UNIQUE INDEX "HomepageCurrentSnapshotProjection_personalized_unique"
  ON "HomepageCurrentSnapshotProjection" (scope, "userId")
  WHERE "userId" IS NOT NULL;
