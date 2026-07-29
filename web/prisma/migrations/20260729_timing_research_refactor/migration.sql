DROP TABLE IF EXISTS "TimingPresetAdjustmentSuggestion" CASCADE;
DROP TABLE IF EXISTS "TimingFeedbackObservation" CASCADE;
DROP TABLE IF EXISTS "TimingExecutionRecord" CASCADE;
DROP TABLE IF EXISTS "TimingBacktestRun" CASCADE;
DROP TABLE IF EXISTS "TimingReviewRecord" CASCADE;
DROP TABLE IF EXISTS "TimingRecommendation" CASCADE;
DROP TABLE IF EXISTS "ResearchReminder" CASCADE;
DROP TABLE IF EXISTS "TimingAnalysisCard" CASCADE;
DROP TABLE IF EXISTS "PortfolioSnapshot" CASCADE;
DROP TYPE IF EXISTS "TimingReviewHorizon" CASCADE;
DROP TYPE IF EXISTS "ResearchReminderType" CASCADE;
DROP TYPE IF EXISTS "ResearchReminderTargetType" CASCADE;
DROP TYPE IF EXISTS "ResearchReminderStatus" CASCADE;

CREATE TABLE "TimingResearchReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workflowRunId" TEXT,
  "watchListId" TEXT,
  "presetId" TEXT,
  "presetRevisionId" TEXT,
  "stockCode" TEXT NOT NULL,
  "stockName" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "signalSnapshotId" TEXT NOT NULL,
  "researchState" TEXT NOT NULL,
  "trendState" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "marketState" TEXT,
  "marketTransition" TEXT,
  "summary" TEXT NOT NULL,
  "dimensions" JSONB NOT NULL,
  "observationConditions" JSONB NOT NULL,
  "dataCompleteness" JSONB NOT NULL,
  "modelOutlook" JSONB,
  "riskFlags" TEXT[],
  "reasoning" JSONB NOT NULL,
  "ruleAudit" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimingResearchReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioComposition" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "positions" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'SAVED',
  "workflowRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortfolioComposition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortfolioRiskDiagnostic" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workflowRunId" TEXT,
  "portfolioCompositionId" TEXT NOT NULL,
  "asOfDate" TIMESTAMP(3) NOT NULL,
  "concentration" JSONB NOT NULL,
  "exposures" JSONB NOT NULL,
  "correlation" JSONB NOT NULL,
  "volatility" JSONB NOT NULL,
  "liquidity" JSONB NOT NULL,
  "scenarios" JSONB NOT NULL,
  "dataQuality" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortfolioRiskDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimingRuleValidationRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "presetRevisionId" TEXT NOT NULL,
  "watchListId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "configHash" TEXT NOT NULL,
  "sampleSnapshot" JSONB NOT NULL,
  "qualityMetrics" JSONB,
  "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimingRuleValidationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortfolioComposition_workflowRunId_key" ON "PortfolioComposition"("workflowRunId");
CREATE INDEX "TimingResearchReport_userId_createdAt_idx" ON "TimingResearchReport"("userId", "createdAt");
CREATE INDEX "TimingResearchReport_workflowRunId_idx" ON "TimingResearchReport"("workflowRunId");
CREATE INDEX "TimingResearchReport_userId_stockCode_createdAt_idx" ON "TimingResearchReport"("userId", "stockCode", "createdAt");
CREATE INDEX "PortfolioComposition_userId_updatedAt_idx" ON "PortfolioComposition"("userId", "updatedAt");
CREATE INDEX "PortfolioRiskDiagnostic_userId_createdAt_idx" ON "PortfolioRiskDiagnostic"("userId", "createdAt");
CREATE INDEX "TimingRuleValidationRun_presetRevisionId_status_createdAt_idx" ON "TimingRuleValidationRun"("presetRevisionId", "status", "createdAt");

ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_watchListId_fkey" FOREIGN KEY ("watchListId") REFERENCES "WatchList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingResearchReport" ADD CONSTRAINT "TimingResearchReport_signalSnapshotId_fkey" FOREIGN KEY ("signalSnapshotId") REFERENCES "TimingSignalSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioComposition" ADD CONSTRAINT "PortfolioComposition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioComposition" ADD CONSTRAINT "PortfolioComposition_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioRiskDiagnostic" ADD CONSTRAINT "PortfolioRiskDiagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioRiskDiagnostic" ADD CONSTRAINT "PortfolioRiskDiagnostic_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioRiskDiagnostic" ADD CONSTRAINT "PortfolioRiskDiagnostic_portfolioCompositionId_fkey" FOREIGN KEY ("portfolioCompositionId") REFERENCES "PortfolioComposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingRuleValidationRun" ADD CONSTRAINT "TimingRuleValidationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingRuleValidationRun" ADD CONSTRAINT "TimingRuleValidationRun_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
