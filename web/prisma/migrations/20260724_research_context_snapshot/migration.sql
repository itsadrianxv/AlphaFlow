ALTER TABLE "EvidenceContextItem"
    ADD COLUMN "recordKind" TEXT NOT NULL DEFAULT 'observation',
    ADD COLUMN "lineageId" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "derivedFromItemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "algorithmVersion" TEXT,
    ADD COLUMN "parametersJson" JSONB,
    ADD COLUMN "correctionOfItemId" TEXT,
    ADD COLUMN "supersedesItemId" TEXT,
    ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

ALTER TABLE "EvidenceContextItem" DROP CONSTRAINT IF EXISTS "EvidenceContextItem_blockId_itemKey_key";
CREATE INDEX "EvidenceContextItem_lineageId_createdAt_idx" ON "EvidenceContextItem"("lineageId", "createdAt");
CREATE INDEX "EvidenceContextItem_correctionOfItemId_idx" ON "EvidenceContextItem"("correctionOfItemId");
CREATE INDEX "EvidenceContextItem_supersedesItemId_idx" ON "EvidenceContextItem"("supersedesItemId");

CREATE TABLE "ResearchContextSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "requestGroupId" TEXT NOT NULL,
    "requestSequence" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "model" TEXT,
    "requestOptionsJson" JSONB,
    "messagesJson" JSONB NOT NULL,
    "qualityJson" JSONB NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ResearchContextSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchContextSnapshotItem" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "projectionJson" JSONB NOT NULL,
    "projectionHash" TEXT NOT NULL,
    "truncationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchContextSnapshotItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchClaim" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "artifactKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchClaimCitation" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'support',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchClaimCitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchContextSnapshot_requestGroupId_attempt_key" ON "ResearchContextSnapshot"("requestGroupId", "attempt");
CREATE INDEX "ResearchContextSnapshot_userId_workflowRunId_createdAt_idx" ON "ResearchContextSnapshot"("userId", "workflowRunId", "createdAt");
CREATE INDEX "ResearchContextSnapshot_workflowRunId_requestSequence_idx" ON "ResearchContextSnapshot"("workflowRunId", "requestSequence");
CREATE UNIQUE INDEX "ResearchContextSnapshotItem_snapshotId_evidenceItemId_key" ON "ResearchContextSnapshotItem"("snapshotId", "evidenceItemId");
CREATE UNIQUE INDEX "ResearchContextSnapshotItem_snapshotId_ordinal_key" ON "ResearchContextSnapshotItem"("snapshotId", "ordinal");
CREATE INDEX "ResearchContextSnapshotItem_evidenceItemId_idx" ON "ResearchContextSnapshotItem"("evidenceItemId");
CREATE UNIQUE INDEX "ResearchClaim_snapshotId_artifactKey_ordinal_key" ON "ResearchClaim"("snapshotId", "artifactKey", "ordinal");
CREATE INDEX "ResearchClaim_snapshotId_createdAt_idx" ON "ResearchClaim"("snapshotId", "createdAt");
CREATE UNIQUE INDEX "ResearchClaimCitation_claimId_evidenceItemId_relation_key" ON "ResearchClaimCitation"("claimId", "evidenceItemId", "relation");
CREATE INDEX "ResearchClaimCitation_evidenceItemId_idx" ON "ResearchClaimCitation"("evidenceItemId");

ALTER TABLE "ResearchContextSnapshot" ADD CONSTRAINT "ResearchContextSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchContextSnapshot" ADD CONSTRAINT "ResearchContextSnapshot_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchContextSnapshotItem" ADD CONSTRAINT "ResearchContextSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ResearchContextSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchContextSnapshotItem" ADD CONSTRAINT "ResearchContextSnapshotItem_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceContextItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResearchClaim" ADD CONSTRAINT "ResearchClaim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ResearchContextSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchClaimCitation" ADD CONSTRAINT "ResearchClaimCitation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ResearchClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchClaimCitation" ADD CONSTRAINT "ResearchClaimCitation_evidenceItemId_fkey" FOREIGN KEY ("evidenceItemId") REFERENCES "EvidenceContextItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_evidence_mutation() RETURNS trigger AS $$
BEGIN
    IF current_setting('app.evidence_allow_mutation', true) = 'on' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'Evidence ledger is append-only; append a new item or use the controlled cleanup path';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_context_immutable BEFORE UPDATE OR DELETE ON "EvidenceContext"
    FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
CREATE TRIGGER evidence_context_block_immutable BEFORE UPDATE OR DELETE ON "EvidenceContextBlock"
    FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
CREATE TRIGGER evidence_context_item_immutable BEFORE UPDATE OR DELETE ON "EvidenceContextItem"
    FOR EACH ROW EXECUTE FUNCTION prevent_evidence_mutation();
