ALTER TABLE "ResearchExternalCopy"
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "claimExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "fencingToken" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ResearchExternalCopy"
  DROP CONSTRAINT "ResearchExternalCopy_status_check",
  ADD CONSTRAINT "ResearchExternalCopy_status_check"
    CHECK ("status" IN (
      'PENDING', 'SENDING', 'RETRY_WAIT', 'DEFERRED_CIRCUIT',
      'SENT', 'FAILED', 'CONFIG_BLOCKED'
    ));

CREATE UNIQUE INDEX "ResearchExternalCopy_claimToken_key"
  ON "ResearchExternalCopy"("claimToken");

CREATE INDEX "ResearchExternalCopy_claim_idx"
  ON "ResearchExternalCopy"("status", "claimExpiresAt");
