CREATE TABLE "HomepageDataManifest" (
  id TEXT PRIMARY KEY,
  "manifestKey" TEXT UNIQUE NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('BASELINE','PERSONALIZED')),
  "definitionVersion" TEXT NOT NULL,
  "targetContextKey" TEXT NOT NULL,
  "targetContextJson" JSONB NOT NULL,
  "gateStatus" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("gateStatus" IN ('PENDING','BLOCKED','READY','READY_WITH_LIMITATION')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageDataManifestItem" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL REFERENCES "HomepageDataManifest"(id) ON DELETE RESTRICT,
  "itemKey" TEXT NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL,
  "datasetKey" TEXT NOT NULL,
  "factScopeKey" TEXT NOT NULL,
  "factScopeJson" JSONB NOT NULL,
  "requirementVersion" TEXT NOT NULL,
  required BOOLEAN NOT NULL,
  "emptyPolicy" TEXT NOT NULL CHECK ("emptyPolicy" IN ('ALLOW_EMPTY','REQUIRE_NON_EMPTY')),
  "targetDataCutoffKey" TEXT NOT NULL,
  "targetDataCutoffJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("manifestId","itemKey")
);

CREATE TABLE "HomepageDataManifestItemAttempt" (
  id TEXT PRIMARY KEY,
  "manifestItemId" TEXT NOT NULL REFERENCES "HomepageDataManifestItem"(id) ON DELETE RESTRICT,
  "attemptNo" INTEGER NOT NULL CHECK ("attemptNo" > 0),
  "idempotencyKey" TEXT UNIQUE NOT NULL,
  "providerKey" TEXT NOT NULL,
  "providerContractVersion" TEXT NOT NULL,
  "normalizationRulesVersion" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL CHECK ("requestFingerprint" LIKE 'sha256:%'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED')),
  "resultStatus" TEXT,
  "resultEnvelopeJson" JSONB,
  "resultHash" TEXT,
  "errorClass" TEXT,
  retryability TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  "workerId" TEXT,
  "fencingToken" BIGINT NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "nextAttemptAt" TIMESTAMPTZ,
  "eventPublishedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("manifestItemId","attemptNo")
);

CREATE TABLE "SourceAssertion" (
  id TEXT PRIMARY KEY,
  "assertionKey" TEXT UNIQUE NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "datasetKey" TEXT NOT NULL,
  "sourceRecordKey" TEXT NOT NULL,
  "observationIdentityKey" TEXT NOT NULL,
  "rawRecordJson" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "requestParamsHash" TEXT NOT NULL,
  "providerVersion" TEXT NOT NULL,
  "upstreamAsOf" TIMESTAMPTZ,
  "sourcePublishedAt" TIMESTAMPTZ,
  "fetchedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "DataObservation" (
  id TEXT PRIMARY KEY,
  "identityKey" TEXT UNIQUE NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "metricCatalogId" TEXT NOT NULL,
  "dimensionsJson" JSONB NOT NULL DEFAULT '{}',
  "observationKind" TEXT NOT NULL,
  "observationDate" DATE,
  "periodStart" DATE,
  "periodEnd" DATE,
  "currentRevisionId" TEXT
);

CREATE TABLE "DataObservationRevision" (
  id TEXT PRIMARY KEY,
  "observationId" TEXT NOT NULL REFERENCES "DataObservation"(id) ON DELETE RESTRICT,
  "revisionNo" INTEGER NOT NULL,
  "revisionDedupKey" TEXT UNIQUE NOT NULL,
  "canonicalizationVersion" TEXT NOT NULL,
  "valueType" TEXT NOT NULL,
  "valueText" TEXT,
  "valueJson" JSONB,
  unit TEXT,
  precision INTEGER,
  "missingReason" TEXT,
  "qualityStatus" TEXT NOT NULL,
  "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "valueHash" TEXT NOT NULL,
  "normalizationRulesVersion" TEXT NOT NULL,
  "supersedesRevisionId" TEXT,
  "correctionOfRevisionId" TEXT,
  "explicitCorrection" BOOLEAN NOT NULL DEFAULT FALSE,
  "upstreamAsOf" TIMESTAMPTZ,
  "sourcePublishedAt" TIMESTAMPTZ,
  "normalizedAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("observationId","revisionNo")
);

ALTER TABLE "DataObservation" ADD CONSTRAINT "DataObservation_currentRevisionId_fkey"
  FOREIGN KEY ("currentRevisionId") REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT;

CREATE TABLE "DataObservationRevisionSource" (
  "revisionId" TEXT NOT NULL REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT,
  "sourceAssertionId" TEXT NOT NULL REFERENCES "SourceAssertion"(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  "authorityStrategyVersion" TEXT NOT NULL,
  "selectionReason" TEXT NOT NULL,
  "fallbackReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY("revisionId","sourceAssertionId")
);

CREATE UNIQUE INDEX "DataObservationRevisionSource_selected_key"
  ON "DataObservationRevisionSource"("revisionId") WHERE role = 'SELECTED';

CREATE TABLE "DataObservationRevisionInput" (
  "revisionId" TEXT NOT NULL REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT,
  "inputRevisionId" TEXT NOT NULL REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "parametersJson" JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY("revisionId","inputRevisionId")
);

CREATE TABLE "ResearchRuntimeObservation" (
  id TEXT PRIMARY KEY,
  "idempotencyKey" TEXT UNIQUE NOT NULL,
  "metricKind" TEXT NOT NULL,
  "sourceKey" TEXT,
  "datasetKey" TEXT,
  stage TEXT,
  "resourcePoolKey" TEXT,
  "productClockAt" TIMESTAMPTZ,
  "readyAt" TIMESTAMPTZ NOT NULL,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  "errorClass" TEXT,
  "observationContextJson" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageDataManifestItemSettlement" (
  id TEXT PRIMARY KEY,
  "manifestItemId" TEXT UNIQUE NOT NULL REFERENCES "HomepageDataManifestItem"(id) ON DELETE RESTRICT,
  "settledAttemptId" TEXT UNIQUE NOT NULL REFERENCES "HomepageDataManifestItemAttempt"(id) ON DELETE RESTRICT,
  "settledFencingToken" BIGINT NOT NULL,
  "selectedRevisionId" TEXT REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT,
  "settlementStatus" TEXT NOT NULL,
  "providerResultStatus" TEXT NOT NULL,
  "requestedScopeJson" JSONB NOT NULL,
  "coveredScopeJson" JSONB NOT NULL,
  "missingScopeJson" JSONB NOT NULL,
  "targetDataCutoffKey" TEXT NOT NULL,
  "targetDataCutoffJson" JSONB NOT NULL,
  "actualDataCutoffKey" TEXT NOT NULL,
  "actualDataCutoffJson" JSONB NOT NULL,
  "qualityStatus" TEXT NOT NULL,
  "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  limitations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorClass" TEXT,
  retryability TEXT,
  "settledAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "HomepageDataManifestItemSettlementRevision" (
  "settlementId" TEXT NOT NULL REFERENCES "HomepageDataManifestItemSettlement"(id) ON DELETE RESTRICT,
  "observationRevisionId" TEXT NOT NULL REFERENCES "DataObservationRevision"(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY("settlementId","observationRevisionId"),
  UNIQUE("settlementId", ordinal)
);
