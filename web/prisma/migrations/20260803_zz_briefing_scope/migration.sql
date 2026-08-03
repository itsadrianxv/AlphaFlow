CREATE TABLE "ResearchBriefingScope" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferenceSnapshotId" TEXT NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "includedIdsJson" JSONB NOT NULL,
    "mandatoryIdsJson" JSONB NOT NULL,
    "draftJson" JSONB,
    "draftHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FROZEN',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchBriefingScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchBriefingScope_taskId_key" ON "ResearchBriefingScope"("taskId");
CREATE UNIQUE INDEX "ResearchBriefingScope_userId_tradingDate_slot_key" ON "ResearchBriefingScope"("userId", "tradingDate", "slot");
CREATE INDEX "ResearchBriefingScope_tradingDate_slot_status_idx" ON "ResearchBriefingScope"("tradingDate", "slot", "status");
ALTER TABLE "ResearchBriefingScope" ADD CONSTRAINT "ResearchBriefingScope_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchBriefingScope" ADD CONSTRAINT "ResearchBriefingScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchBriefingScope" ADD CONSTRAINT "ResearchBriefingScope_preferenceSnapshotId_fkey" FOREIGN KEY ("preferenceSnapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO "ResearchResourcePool" ("id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency")
VALUES ('briefing-research-production-pool-v1', 'briefing:research-production', 'BRIEFING', 4, 2)
ON CONFLICT ("poolKey") DO NOTHING;
