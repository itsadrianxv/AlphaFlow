-- DropIndex
DROP INDEX "EvidenceContextItem_blockId_itemKey_key";

-- DropIndex
DROP INDEX "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_mode_key";

-- AlterTable
ALTER TABLE "EvidenceContextItem" ALTER COLUMN "lineageId" DROP DEFAULT,
ALTER COLUMN "contentHash" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "PortfolioComposition_userId_name_idx" ON "PortfolioComposition"("userId", "name");

-- CreateIndex
CREATE INDEX "PortfolioRiskDiagnostic_workflowRunId_idx" ON "PortfolioRiskDiagnostic"("workflowRunId");

-- CreateIndex
CREATE INDEX "PortfolioRiskDiagnostic_portfolioCompositionId_createdAt_idx" ON "PortfolioRiskDiagnostic"("portfolioCompositionId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTaskEvidence_executionId_createdAt_idx" ON "ScheduledTaskEvidence"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTaskVersion_taskId_createdAt_idx" ON "ScheduledTaskVersion"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingResearchReport_watchListId_createdAt_idx" ON "TimingResearchReport"("watchListId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingResearchReport_presetId_idx" ON "TimingResearchReport"("presetId");

-- CreateIndex
CREATE INDEX "TimingResearchReport_presetRevisionId_idx" ON "TimingResearchReport"("presetRevisionId");

-- CreateIndex
CREATE INDEX "TimingResearchReport_signalSnapshotId_idx" ON "TimingResearchReport"("signalSnapshotId");

-- CreateIndex
CREATE INDEX "TimingResearchReport_sourceType_sourceId_idx" ON "TimingResearchReport"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TimingRuleValidationRun_userId_createdAt_idx" ON "TimingRuleValidationRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingRuleValidationRun_watchListId_createdAt_idx" ON "TimingRuleValidationRun"("watchListId", "createdAt");
