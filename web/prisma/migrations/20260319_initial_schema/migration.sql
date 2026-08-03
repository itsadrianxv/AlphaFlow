-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScreeningSessionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScreeningInsightStatus" AS ENUM ('ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResearchReminderType" AS ENUM ('REVIEW');

-- CreateEnum
CREATE TYPE "ResearchReminderTargetType" AS ENUM ('SCREENING_INSIGHT', 'TIMING_REVIEW');

-- CreateEnum
CREATE TYPE "ResearchReminderStatus" AS ENUM ('PENDING', 'TRIGGERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimingReviewHorizon" AS ENUM ('T5', 'T10', 'T20');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowNodeRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkflowEventType" AS ENUM ('RUN_CREATED', 'RUN_STARTED', 'RUN_PAUSED', 'RUN_RESUMED', 'RUN_CANCEL_REQUESTED', 'RUN_CANCELLED', 'RUN_SUCCEEDED', 'RUN_FAILED', 'NODE_STARTED', 'NODE_PROGRESS', 'NODE_SUCCEEDED', 'NODE_FAILED');

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "refresh_token_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ScreeningStrategy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "scoringConfig" JSONB NOT NULL,
    "tags" TEXT[],
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScreeningStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningSession" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT,
    "strategyName" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ScreeningSessionStatus" NOT NULL DEFAULT 'PENDING',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "errorMessage" TEXT,
    "cancellationRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalScanned" INTEGER NOT NULL,
    "executionTime" DOUBLE PRECISION NOT NULL,
    "topStocks" JSONB NOT NULL,
    "otherStockCodes" TEXT[],
    "filtersSnapshot" JSONB NOT NULL,
    "scoringConfigSnapshot" JSONB NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScreeningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stocks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WatchList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screeningSessionId" TEXT NOT NULL,
    "watchListId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" "ScreeningInsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT NOT NULL,
    "nextReviewAt" TIMESTAMP(3),
    "qualityFlags" TEXT[],
    "confidenceScore" DOUBLE PRECISION,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'unknown',
    "confidenceStatus" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "supportedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "insufficientClaimCount" INTEGER NOT NULL DEFAULT 0,
    "contradictedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "latestVersionId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningInsightVersion" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "thesisJson" JSONB NOT NULL,
    "risksJson" JSONB NOT NULL,
    "catalystsJson" JSONB NOT NULL,
    "reviewPlanJson" JSONB NOT NULL,
    "evidenceRefsJson" JSONB NOT NULL,
    "qualityFlagsJson" JSONB NOT NULL,
    "confidenceAnalysisJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningInsightVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "screeningInsightId" TEXT,
    "timingReviewRecordId" TEXT,
    "stockCode" TEXT NOT NULL,
    "reminderType" "ResearchReminderType" NOT NULL,
    "targetType" "ResearchReminderTargetType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ResearchReminderStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingSignalSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT 'DAILY',
    "barsCount" INTEGER NOT NULL,
    "indicators" JSONB NOT NULL,
    "signalContext" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimingSignalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingAnalysisCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "watchListId" TEXT,
    "presetId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "signalSnapshotId" TEXT NOT NULL,
    "actionBias" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "marketState" TEXT,
    "marketTransition" TEXT,
    "summary" TEXT NOT NULL,
    "triggerNotes" TEXT[],
    "invalidationNotes" TEXT[],
    "riskFlags" TEXT[],
    "reasoning" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingAnalysisCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
    "cash" DOUBLE PRECISION NOT NULL,
    "totalCapital" DOUBLE PRECISION NOT NULL,
    "positions" JSONB NOT NULL,
    "riskPreferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "portfolioSnapshotId" TEXT NOT NULL,
    "watchListId" TEXT NOT NULL,
    "presetId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "suggestedMinPct" DOUBLE PRECISION NOT NULL,
    "suggestedMaxPct" DOUBLE PRECISION NOT NULL,
    "riskBudgetPct" DOUBLE PRECISION NOT NULL,
    "marketState" TEXT NOT NULL,
    "marketTransition" TEXT NOT NULL,
    "riskFlags" TEXT[],
    "reasoning" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingReviewRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisCardId" TEXT,
    "recommendationId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "sourceAsOfDate" TIMESTAMP(3) NOT NULL,
    "reviewHorizon" "TimingReviewHorizon" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expectedAction" TEXT NOT NULL,
    "actualReturnPct" DOUBLE PRECISION,
    "maxFavorableExcursionPct" DOUBLE PRECISION,
    "maxAdverseExcursionPct" DOUBLE PRECISION,
    "verdict" TEXT,
    "reviewSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingMarketContextSnapshot" (
    "id" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "persistenceDays" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "analysisJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingMarketContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingFeedbackObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewRecordId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "presetId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceAsOfDate" TIMESTAMP(3) NOT NULL,
    "reviewHorizon" "TimingReviewHorizon" NOT NULL,
    "expectedAction" TEXT NOT NULL,
    "signalContext" JSONB NOT NULL,
    "marketContext" JSONB,
    "positionContext" JSONB,
    "actualReturnPct" DOUBLE PRECISION NOT NULL,
    "maxFavorableExcursionPct" DOUBLE PRECISION NOT NULL,
    "maxAdverseExcursionPct" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingFeedbackObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingPresetAdjustmentSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingPresetAdjustmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graphConfig" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PENDING',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "currentNodeKey" TEXT,
    "checkpointKey" TEXT,
    "cancellationRequestedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNodeRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowNodeRunStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowNodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeRunId" TEXT,
    "sequence" INTEGER NOT NULL,
    "eventType" "WorkflowEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_name_idx" ON "Post"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "ScreeningStrategy_userId_idx" ON "ScreeningStrategy"("userId");

-- CreateIndex
CREATE INDEX "ScreeningStrategy_isTemplate_idx" ON "ScreeningStrategy"("isTemplate");

-- CreateIndex
CREATE INDEX "ScreeningStrategy_name_idx" ON "ScreeningStrategy"("name");

-- CreateIndex
CREATE INDEX "ScreeningSession_userId_idx" ON "ScreeningSession"("userId");

-- CreateIndex
CREATE INDEX "ScreeningSession_strategyId_idx" ON "ScreeningSession"("strategyId");

-- CreateIndex
CREATE INDEX "ScreeningSession_executedAt_idx" ON "ScreeningSession"("executedAt");

-- CreateIndex
CREATE INDEX "ScreeningSession_status_executedAt_idx" ON "ScreeningSession"("status", "executedAt");

-- CreateIndex
CREATE INDEX "WatchList_userId_idx" ON "WatchList"("userId");

-- CreateIndex
CREATE INDEX "WatchList_name_idx" ON "WatchList"("name");

-- CreateIndex
CREATE INDEX "ScreeningInsight_userId_updatedAt_idx" ON "ScreeningInsight"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ScreeningInsight_screeningSessionId_idx" ON "ScreeningInsight"("screeningSessionId");

-- CreateIndex
CREATE INDEX "ScreeningInsight_stockCode_idx" ON "ScreeningInsight"("stockCode");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInsight_screeningSessionId_stockCode_key" ON "ScreeningInsight"("screeningSessionId", "stockCode");

-- CreateIndex
CREATE INDEX "ScreeningInsightVersion_insightId_createdAt_idx" ON "ScreeningInsightVersion"("insightId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningInsightVersion_insightId_version_key" ON "ScreeningInsightVersion"("insightId", "version");

-- CreateIndex
CREATE INDEX "ResearchReminder_userId_targetType_status_scheduledAt_idx" ON "ResearchReminder"("userId", "targetType", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ResearchReminder_screeningInsightId_idx" ON "ResearchReminder"("screeningInsightId");

-- CreateIndex
CREATE INDEX "ResearchReminder_timingReviewRecordId_idx" ON "ResearchReminder"("timingReviewRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReminder_screeningInsightId_reminderType_scheduledA_key" ON "ResearchReminder"("screeningInsightId", "reminderType", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReminder_timingReviewRecordId_reminderType_schedule_key" ON "ResearchReminder"("timingReviewRecordId", "reminderType", "scheduledAt");

-- CreateIndex
CREATE INDEX "TimingSignalSnapshot_userId_createdAt_idx" ON "TimingSignalSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingSignalSnapshot_workflowRunId_idx" ON "TimingSignalSnapshot"("workflowRunId");

-- CreateIndex
CREATE INDEX "TimingSignalSnapshot_userId_stockCode_asOfDate_idx" ON "TimingSignalSnapshot"("userId", "stockCode", "asOfDate");

-- CreateIndex
CREATE INDEX "TimingSignalSnapshot_sourceType_sourceId_idx" ON "TimingSignalSnapshot"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_userId_createdAt_idx" ON "TimingAnalysisCard"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_workflowRunId_idx" ON "TimingAnalysisCard"("workflowRunId");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_watchListId_createdAt_idx" ON "TimingAnalysisCard"("watchListId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_presetId_idx" ON "TimingAnalysisCard"("presetId");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_signalSnapshotId_idx" ON "TimingAnalysisCard"("signalSnapshotId");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_userId_stockCode_createdAt_idx" ON "TimingAnalysisCard"("userId", "stockCode", "createdAt");

-- CreateIndex
CREATE INDEX "TimingAnalysisCard_sourceType_sourceId_idx" ON "TimingAnalysisCard"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_userId_updatedAt_idx" ON "PortfolioSnapshot"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_userId_name_idx" ON "PortfolioSnapshot"("userId", "name");

-- CreateIndex
CREATE INDEX "TimingRecommendation_userId_createdAt_idx" ON "TimingRecommendation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingRecommendation_workflowRunId_idx" ON "TimingRecommendation"("workflowRunId");

-- CreateIndex
CREATE INDEX "TimingRecommendation_portfolioSnapshotId_createdAt_idx" ON "TimingRecommendation"("portfolioSnapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingRecommendation_watchListId_createdAt_idx" ON "TimingRecommendation"("watchListId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingRecommendation_presetId_idx" ON "TimingRecommendation"("presetId");

-- CreateIndex
CREATE INDEX "TimingRecommendation_userId_stockCode_createdAt_idx" ON "TimingRecommendation"("userId", "stockCode", "createdAt");

-- CreateIndex
CREATE INDEX "TimingReviewRecord_userId_scheduledAt_completedAt_idx" ON "TimingReviewRecord"("userId", "scheduledAt", "completedAt");

-- CreateIndex
CREATE INDEX "TimingReviewRecord_analysisCardId_idx" ON "TimingReviewRecord"("analysisCardId");

-- CreateIndex
CREATE INDEX "TimingReviewRecord_recommendationId_idx" ON "TimingReviewRecord"("recommendationId");

-- CreateIndex
CREATE INDEX "TimingReviewRecord_stockCode_scheduledAt_idx" ON "TimingReviewRecord"("stockCode", "scheduledAt");

-- CreateIndex
CREATE INDEX "TimingPreset_userId_updatedAt_idx" ON "TimingPreset"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimingPreset_userId_name_key" ON "TimingPreset"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TimingMarketContextSnapshot_asOfDate_key" ON "TimingMarketContextSnapshot"("asOfDate");

-- CreateIndex
CREATE INDEX "TimingMarketContextSnapshot_asOfDate_idx" ON "TimingMarketContextSnapshot"("asOfDate");

-- CreateIndex
CREATE INDEX "TimingMarketContextSnapshot_state_updatedAt_idx" ON "TimingMarketContextSnapshot"("state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimingFeedbackObservation_reviewRecordId_key" ON "TimingFeedbackObservation"("reviewRecordId");

-- CreateIndex
CREATE INDEX "TimingFeedbackObservation_userId_createdAt_idx" ON "TimingFeedbackObservation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingFeedbackObservation_presetId_createdAt_idx" ON "TimingFeedbackObservation"("presetId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingFeedbackObservation_recommendationId_idx" ON "TimingFeedbackObservation"("recommendationId");

-- CreateIndex
CREATE INDEX "TimingPresetAdjustmentSuggestion_userId_createdAt_idx" ON "TimingPresetAdjustmentSuggestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimingPresetAdjustmentSuggestion_presetId_status_createdAt_idx" ON "TimingPresetAdjustmentSuggestion"("presetId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_code_isActive_idx" ON "WorkflowTemplate"("code", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_code_version_key" ON "WorkflowTemplate"("code", "version");

-- CreateIndex
CREATE INDEX "WorkflowRun_templateId_idx" ON "WorkflowRun"("templateId");

-- CreateIndex
CREATE INDEX "WorkflowRun_userId_createdAt_idx" ON "WorkflowRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_userId_idempotencyKey_idx" ON "WorkflowRun"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_createdAt_idx" ON "WorkflowRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowNodeRun_runId_status_idx" ON "WorkflowNodeRun"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowNodeRun_runId_nodeKey_attempt_key" ON "WorkflowNodeRun"("runId", "nodeKey", "attempt");

-- CreateIndex
CREATE INDEX "WorkflowEvent_runId_occurredAt_idx" ON "WorkflowEvent"("runId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEvent_runId_sequence_key" ON "WorkflowEvent"("runId", "sequence");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningStrategy" ADD CONSTRAINT "ScreeningStrategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "ScreeningStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningSession" ADD CONSTRAINT "ScreeningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchList" ADD CONSTRAINT "WatchList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInsight" ADD CONSTRAINT "ScreeningInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInsight" ADD CONSTRAINT "ScreeningInsight_screeningSessionId_fkey" FOREIGN KEY ("screeningSessionId") REFERENCES "ScreeningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInsight" ADD CONSTRAINT "ScreeningInsight_watchListId_fkey" FOREIGN KEY ("watchListId") REFERENCES "WatchList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningInsightVersion" ADD CONSTRAINT "ScreeningInsightVersion_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "ScreeningInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReminder" ADD CONSTRAINT "ResearchReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReminder" ADD CONSTRAINT "ResearchReminder_screeningInsightId_fkey" FOREIGN KEY ("screeningInsightId") REFERENCES "ScreeningInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReminder" ADD CONSTRAINT "ResearchReminder_timingReviewRecordId_fkey" FOREIGN KEY ("timingReviewRecordId") REFERENCES "TimingReviewRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingSignalSnapshot" ADD CONSTRAINT "TimingSignalSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingSignalSnapshot" ADD CONSTRAINT "TimingSignalSnapshot_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_watchListId_fkey" FOREIGN KEY ("watchListId") REFERENCES "WatchList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnalysisCard" ADD CONSTRAINT "TimingAnalysisCard_signalSnapshotId_fkey" FOREIGN KEY ("signalSnapshotId") REFERENCES "TimingSignalSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_portfolioSnapshotId_fkey" FOREIGN KEY ("portfolioSnapshotId") REFERENCES "PortfolioSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_watchListId_fkey" FOREIGN KEY ("watchListId") REFERENCES "WatchList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingRecommendation" ADD CONSTRAINT "TimingRecommendation_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingReviewRecord" ADD CONSTRAINT "TimingReviewRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingReviewRecord" ADD CONSTRAINT "TimingReviewRecord_analysisCardId_fkey" FOREIGN KEY ("analysisCardId") REFERENCES "TimingAnalysisCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingReviewRecord" ADD CONSTRAINT "TimingReviewRecord_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "TimingRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingPreset" ADD CONSTRAINT "TimingPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingFeedbackObservation" ADD CONSTRAINT "TimingFeedbackObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingFeedbackObservation" ADD CONSTRAINT "TimingFeedbackObservation_reviewRecordId_fkey" FOREIGN KEY ("reviewRecordId") REFERENCES "TimingReviewRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingFeedbackObservation" ADD CONSTRAINT "TimingFeedbackObservation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "TimingRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingFeedbackObservation" ADD CONSTRAINT "TimingFeedbackObservation_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingPresetAdjustmentSuggestion" ADD CONSTRAINT "TimingPresetAdjustmentSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingPresetAdjustmentSuggestion" ADD CONSTRAINT "TimingPresetAdjustmentSuggestion_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "TimingPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNodeRun" ADD CONSTRAINT "WorkflowNodeRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_nodeRunId_fkey" FOREIGN KEY ("nodeRunId") REFERENCES "WorkflowNodeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
