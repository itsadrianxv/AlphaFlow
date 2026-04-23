import { randomUUID } from "node:crypto";
import { env } from "~/platform/env";
import { ConfidenceAnalysisService } from "~/modules/research/server/application/intelligence/confidence-analysis-service";
import { CompanyResearchWorkflowService } from "~/modules/research/server/application/intelligence/company-research-workflow-service";
import { WorkflowExecutionService } from "~/modules/research/server/application/workflow/execution-service";
import { InsightSynthesisService } from "~/modules/research/server/application/intelligence/insight-synthesis-service";
import { ReminderSchedulingService } from "~/modules/research/server/application/intelligence/reminder-scheduling-service";
import { CompanyResearchAgentService } from "~/modules/research/server/application/intelligence/company-research-agent-service";
import { IntelligenceAgentService } from "~/modules/research/server/application/intelligence/intelligence-agent-service";
import { QuickResearchWorkflowService } from "~/modules/research/server/application/intelligence/quick-research-workflow-service";
import { ResearchToolRegistry } from "~/modules/research/server/application/intelligence/research-tool-registry";
import { MarketRegimeService } from "~/modules/timing/server/application/market-regime-service";
import { TimingAnalysisService } from "~/modules/timing/server/application/timing-analysis-service";
import { TimingFeedbackService } from "~/modules/timing/server/application/timing-feedback-service";
import { PositionContextService } from "~/modules/timing/server/application/position-context-service";
import { TimingReviewSchedulingService } from "~/modules/timing/server/application/timing-review-scheduling-service";
import { WatchlistPortfolioManagerService } from "~/modules/timing/server/application/watchlist-portfolio-manager-service";
import { WatchlistRiskManagerService } from "~/modules/timing/server/application/watchlist-risk-manager-service";
import { db } from "~/platform/db";
import { InsightQualityService } from "~/modules/research/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/modules/research/server/domain/intelligence/services/review-plan-policy";
import { TimingActionPolicy } from "~/modules/timing/server/domain/services/timing-action-policy";
import { TimingConfidencePolicy } from "~/modules/timing/server/domain/services/timing-confidence-policy";
import { TimingReviewPolicy } from "~/modules/timing/server/domain/services/timing-review-policy";
import { DeepSeekClient } from "~/modules/research/server/infrastructure/intelligence/deepseek-client";
import { PythonCapabilityGatewayClient } from "~/modules/research/server/infrastructure/capabilities/python-capability-gateway-client";
import { PrismaResearchReminderRepository } from "~/modules/research/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PythonConfidenceAnalysisClient } from "~/modules/research/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/modules/research/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaWatchListRepository } from "~/modules/screening/server/infrastructure/prisma-watch-list-repository";
import { PrismaPortfolioSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-portfolio-snapshot-repository";
import { PrismaTimingFeedbackObservationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-feedback-observation-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingReviewRecordRepository } from "~/modules/timing/server/infrastructure/prisma-timing-review-record-repository";
import { PythonTimingDataClient } from "~/modules/timing/server/infrastructure/python-timing-data-client";
import { PrismaTimingAnalysisCardRepository } from "~/modules/timing/server/infrastructure/prisma-timing-analysis-card-repository";
import { PrismaTimingRecommendationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-recommendation-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-signal-snapshot-repository";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/modules/research/server/workflows/langgraph/company-research-graph";
import { QuickResearchLangGraph } from "~/modules/research/server/workflows/langgraph/quick-research-graph";
import { TimingSignalPipelineLangGraph } from "~/modules/research/server/workflows/langgraph/timing-signal-graph";
import { TimingReviewLoopLangGraph } from "~/modules/research/server/workflows/langgraph/timing-review-loop-graph";
import { WatchlistTimingPipelineLangGraph } from "~/modules/research/server/workflows/langgraph/watchlist-timing-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/modules/research/server/workflows/langgraph/watchlist-timing-cards-graph";
import { PrismaWorkflowRunRepository } from "~/modules/research/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/platform/workflow-runtime/redis/redis-workflow-runtime-store";

const workflowRepository = new PrismaWorkflowRunRepository(db);
const deepSeekClient = new DeepSeekClient();
const pythonDataClient = new PythonIntelligenceDataClient();
const capabilityGatewayClient = new PythonCapabilityGatewayClient();
const confidenceAnalysisService = new ConfidenceAnalysisService({
  client: new PythonConfidenceAnalysisClient(),
});
const companyResearchService = new CompanyResearchAgentService({
  deepSeekClient,
  pythonCapabilityGatewayClient: capabilityGatewayClient,
  pythonIntelligenceDataClient: pythonDataClient,
  confidenceAnalysisService,
});
const researchToolRegistry = new ResearchToolRegistry({
  deepSeekClient,
  pythonCapabilityGatewayClient: capabilityGatewayClient,
  pythonIntelligenceDataClient: pythonDataClient,
});
const quickResearchWorkflowService = new QuickResearchWorkflowService({
  client: deepSeekClient,
  intelligenceService: new IntelligenceAgentService({
    deepSeekClient,
    dataClient: pythonDataClient,
    confidenceAnalysisService,
  }),
});
const companyResearchWorkflowService = new CompanyResearchWorkflowService({
  client: deepSeekClient,
  companyResearchService,
  researchToolRegistry,
});
const reminderRepository = new PrismaResearchReminderRepository(db);
const watchListRepository = new PrismaWatchListRepository(db);
const portfolioSnapshotRepository = new PrismaPortfolioSnapshotRepository(db);
const timingMarketContextSnapshotRepository =
  new PrismaTimingMarketContextSnapshotRepository(db);
const timingPresetRepository = new PrismaTimingPresetRepository(db);
const timingFeedbackObservationRepository =
  new PrismaTimingFeedbackObservationRepository(db);
const timingPresetAdjustmentSuggestionRepository =
  new PrismaTimingPresetAdjustmentSuggestionRepository(db);
const timingReviewRecordRepository = new PrismaTimingReviewRecordRepository(db);
const timingSignalSnapshotRepository =
  new PrismaTimingSignalSnapshotRepository(db);
const timingAnalysisCardRepository = new PrismaTimingAnalysisCardRepository(db);
const timingRecommendationRepository =
  new PrismaTimingRecommendationRepository(db);
const reminderSchedulingService = new ReminderSchedulingService({
  reminderRepository,
});
const synthesisService = new InsightSynthesisService({
  completionClient: deepSeekClient,
  reviewPlanPolicy: new ReviewPlanPolicy(),
  qualityService: new InsightQualityService(),
});
const timingAnalysisService = new TimingAnalysisService({
  confidencePolicy: new TimingConfidencePolicy(),
  actionPolicy: new TimingActionPolicy(),
});
const marketRegimeService = new MarketRegimeService();
const watchlistRiskManagerService = new WatchlistRiskManagerService();
const timingFeedbackService = new TimingFeedbackService({
  observationRepository: timingFeedbackObservationRepository,
  suggestionRepository: timingPresetAdjustmentSuggestionRepository,
});
const watchlistPortfolioManagerService = new WatchlistPortfolioManagerService({
  positionContextService: new PositionContextService(),
});
const pythonTimingDataClient = new PythonTimingDataClient();
const timingReviewSchedulingService = new TimingReviewSchedulingService({
  reviewRecordRepository: timingReviewRecordRepository,
  reminderSchedulingService,
});
const executionService = new WorkflowExecutionService({
  repository: workflowRepository,
  runtimeStore: new RedisWorkflowRuntimeStore(),
  graphs: [
    new QuickResearchLangGraph(quickResearchWorkflowService),
    new CompanyResearchLangGraph(companyResearchService),
    new LegacyCompanyResearchLangGraph(companyResearchService),
    new ODRCompanyResearchLangGraph(companyResearchWorkflowService),
    new CompanyResearchContractLangGraph(companyResearchWorkflowService),
    new TimingSignalPipelineLangGraph({
      timingDataClient: pythonTimingDataClient,
      analysisService: timingAnalysisService,
      presetRepository: timingPresetRepository,
      signalSnapshotRepository: timingSignalSnapshotRepository,
      analysisCardRepository: timingAnalysisCardRepository,
    }),
    new WatchlistTimingCardsPipelineLangGraph({
      watchListRepository,
      timingDataClient: pythonTimingDataClient,
      analysisService: timingAnalysisService,
      presetRepository: timingPresetRepository,
      signalSnapshotRepository: timingSignalSnapshotRepository,
      analysisCardRepository: timingAnalysisCardRepository,
    }),
    new WatchlistTimingPipelineLangGraph({
      watchListRepository,
      portfolioSnapshotRepository,
      timingDataClient: pythonTimingDataClient,
      analysisService: timingAnalysisService,
      presetRepository: timingPresetRepository,
      marketContextSnapshotRepository: timingMarketContextSnapshotRepository,
      marketRegimeService,
      feedbackService: timingFeedbackService,
      riskManagerService: watchlistRiskManagerService,
      portfolioManagerService: watchlistPortfolioManagerService,
      recommendationRepository: timingRecommendationRepository,
      reviewSchedulingService: timingReviewSchedulingService,
    }),
    new TimingReviewLoopLangGraph({
      timingDataClient: pythonTimingDataClient,
      reviewRecordRepository: timingReviewRecordRepository,
      recommendationRepository: timingRecommendationRepository,
      analysisCardRepository: timingAnalysisCardRepository,
      feedbackObservationRepository: timingFeedbackObservationRepository,
      presetRepository: timingPresetRepository,
      feedbackService: timingFeedbackService,
      reminderRepository,
      reviewPolicy: new TimingReviewPolicy(),
    }),
  ],
});

const workerId = process.env.WORKFLOW_WORKER_ID ?? `workflow-worker-${randomUUID()}`;
const pollIntervalMs = env.WORKFLOW_WORKER_POLL_INTERVAL_MS;

let shuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info(`[workflow-worker] receive ${signal}, shutting down...`);

  await db.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main() {
  console.info(`[workflow-worker] started: ${workerId}`);

  while (!shuttingDown) {
    try {
      const recovered = await executionService.executeRecoverableRunningRun(workerId);

      if (recovered) {
        continue;
      }

      const picked = await executionService.executeNextPendingRun(workerId);

      if (!picked) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[workflow-worker] loop error: ${message}`);
      await sleep(pollIntervalMs);
    }
  }
}

void main();
