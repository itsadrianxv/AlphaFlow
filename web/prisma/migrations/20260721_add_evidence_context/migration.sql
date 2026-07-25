CREATE TABLE "EvidenceContext" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT,
    "phase" TEXT,
    "metadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceContextBlock" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "blockKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "limitations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceContextBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceContextItem" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "extractedFact" TEXT,
    "snippet" TEXT,
    "valueJson" JSONB,
    "rawValueJson" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "fallbackFrom" TEXT,
    "missingReason" TEXT,
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "limitations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceContextItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvidenceContextBlock_contextId_blockKey_key"
    ON "EvidenceContextBlock"("contextId", "blockKey");
CREATE UNIQUE INDEX "EvidenceContextItem_blockId_itemKey_key"
    ON "EvidenceContextItem"("blockId", "itemKey");
CREATE INDEX "EvidenceContext_userId_subjectType_subjectId_createdAt_idx"
    ON "EvidenceContext"("userId", "subjectType", "subjectId", "createdAt");
CREATE INDEX "EvidenceContext_workflowRunId_createdAt_idx"
    ON "EvidenceContext"("workflowRunId", "createdAt");
CREATE INDEX "EvidenceContextBlock_blockKey_createdAt_idx"
    ON "EvidenceContextBlock"("blockKey", "createdAt");
CREATE INDEX "EvidenceContextItem_userId_contextId_createdAt_idx"
    ON "EvidenceContextItem"("userId", "contextId", "createdAt");
CREATE INDEX "EvidenceContextItem_sourceType_sourceId_idx"
    ON "EvidenceContextItem"("sourceType", "sourceId");

ALTER TABLE "EvidenceContext"
    ADD CONSTRAINT "EvidenceContext_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceContext"
    ADD CONSTRAINT "EvidenceContext_workflowRunId_fkey"
    FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceContextBlock"
    ADD CONSTRAINT "EvidenceContextBlock_contextId_fkey"
    FOREIGN KEY ("contextId") REFERENCES "EvidenceContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceContextItem"
    ADD CONSTRAINT "EvidenceContextItem_contextId_fkey"
    FOREIGN KEY ("contextId") REFERENCES "EvidenceContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceContextItem"
    ADD CONSTRAINT "EvidenceContextItem_blockId_fkey"
    FOREIGN KEY ("blockId") REFERENCES "EvidenceContextBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceContextItem"
    ADD CONSTRAINT "EvidenceContextItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
