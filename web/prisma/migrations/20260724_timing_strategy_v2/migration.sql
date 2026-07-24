-- 开发期择时模块重置：保留用户、自选股、筛选和非择时研究数据。
DELETE FROM "EvidenceContext" WHERE "phase" = 'timing';
DELETE FROM "TimingPresetAdjustmentSuggestion";
DELETE FROM "TimingFeedbackObservation";
DELETE FROM "TimingReviewRecord";
DELETE FROM "TimingRecommendation";
DELETE FROM "TimingAnalysisCard";
DELETE FROM "TimingSignalSnapshot";
DELETE FROM "TimingKronosForecastSnapshot";
DELETE FROM "TimingMarketContextSnapshot";
DELETE FROM "PortfolioSnapshot";
DELETE FROM "TimingPreset";

DELETE FROM "WorkflowRun"
WHERE "templateId" IN (
    SELECT "id"
    FROM "WorkflowTemplate"
    WHERE "code" IN (
        'timing_signal_pipeline_v1',
        'watchlist_timing_cards_pipeline_v1',
        'watchlist_timing_pipeline_v1',
        'screening_to_timing_v1',
        'timing_review_loop_v1'
    )
);

ALTER TABLE "TimingPreset" ADD COLUMN "activeRevisionId" TEXT;

CREATE TABLE "TimingPresetRevision" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimingPresetRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TimingSignalSnapshot"
    ADD COLUMN "presetRevisionId" TEXT,
    ADD COLUMN "featureEvidence" JSONB,
    ADD COLUMN "dataManifest" JSONB,
    ADD COLUMN "featureVersion" TEXT,
    ADD COLUMN "inputHash" TEXT;

ALTER TABLE "TimingAnalysisCard"
    ADD COLUMN "presetRevisionId" TEXT,
    ADD COLUMN "decisionStatus" TEXT,
    ADD COLUMN "decisionAudit" JSONB;

ALTER TABLE "TimingRecommendation"
    ADD COLUMN "presetRevisionId" TEXT,
    ADD COLUMN "decisionStatus" TEXT,
    ADD COLUMN "decisionAudit" JSONB;

ALTER TABLE "TimingReviewRecord"
    ADD COLUMN "reviewTradingDays" INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN "benchmarkReturnPct" DOUBLE PRECISION,
    ADD COLUMN "excessReturnPct" DOUBLE PRECISION,
    ADD COLUMN "invalidationTriggered" BOOLEAN,
    ADD COLUMN "executionDeviationPct" DOUBLE PRECISION;

CREATE TABLE "TimingBacktestRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetRevisionId" TEXT NOT NULL,
    "watchListId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "configHash" TEXT NOT NULL,
    "universeSnapshot" JSONB NOT NULL,
    "executionAssumptions" JSONB NOT NULL,
    "qualityMetrics" JSONB,
    "performanceMetrics" JSONB,
    "eventSnapshot" JSONB,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimingBacktestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimingExecutionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetRevisionId" TEXT NOT NULL,
    "analysisCardId" TEXT,
    "recommendationId" TEXT,
    "decision" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION,
    "fees" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimingExecutionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimingPreset_activeRevisionId_key" ON "TimingPreset"("activeRevisionId");
CREATE UNIQUE INDEX "TimingPresetRevision_presetId_revisionNumber_key" ON "TimingPresetRevision"("presetId", "revisionNumber");
CREATE INDEX "TimingPresetRevision_presetId_configHash_idx" ON "TimingPresetRevision"("presetId", "configHash");
CREATE INDEX "TimingPresetRevision_userId_status_updatedAt_idx" ON "TimingPresetRevision"("userId", "status", "updatedAt");
CREATE INDEX "TimingSignalSnapshot_presetRevisionId_idx" ON "TimingSignalSnapshot"("presetRevisionId");
CREATE INDEX "TimingSignalSnapshot_inputHash_idx" ON "TimingSignalSnapshot"("inputHash");
CREATE INDEX "TimingAnalysisCard_presetRevisionId_idx" ON "TimingAnalysisCard"("presetRevisionId");
CREATE INDEX "TimingRecommendation_presetRevisionId_idx" ON "TimingRecommendation"("presetRevisionId");
CREATE INDEX "TimingBacktestRun_userId_createdAt_idx" ON "TimingBacktestRun"("userId", "createdAt");
CREATE INDEX "TimingBacktestRun_presetRevisionId_status_createdAt_idx" ON "TimingBacktestRun"("presetRevisionId", "status", "createdAt");
CREATE INDEX "TimingBacktestRun_watchListId_createdAt_idx" ON "TimingBacktestRun"("watchListId", "createdAt");
CREATE INDEX "TimingExecutionRecord_userId_createdAt_idx" ON "TimingExecutionRecord"("userId", "createdAt");
CREATE INDEX "TimingExecutionRecord_presetRevisionId_createdAt_idx" ON "TimingExecutionRecord"("presetRevisionId", "createdAt");
CREATE INDEX "TimingExecutionRecord_analysisCardId_idx" ON "TimingExecutionRecord"("analysisCardId");
CREATE INDEX "TimingExecutionRecord_recommendationId_idx" ON "TimingExecutionRecord"("recommendationId");

ALTER TABLE "TimingPresetRevision" ADD CONSTRAINT "TimingPresetRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingPresetRevision" ADD CONSTRAINT "TimingPresetRevision_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingPreset" ADD CONSTRAINT "TimingPreset_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingSignalSnapshot" ADD CONSTRAINT "TimingSignalSnapshot_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingBacktestRun" ADD CONSTRAINT "TimingBacktestRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingBacktestRun" ADD CONSTRAINT "TimingBacktestRun_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingExecutionRecord" ADD CONSTRAINT "TimingExecutionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingExecutionRecord" ADD CONSTRAINT "TimingExecutionRecord_presetRevisionId_fkey" FOREIGN KEY ("presetRevisionId") REFERENCES "TimingPresetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimingExecutionRecord" ADD CONSTRAINT "TimingExecutionRecord_analysisCardId_fkey" FOREIGN KEY ("analysisCardId") REFERENCES "TimingAnalysisCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimingExecutionRecord" ADD CONSTRAINT "TimingExecutionRecord_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "TimingRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
