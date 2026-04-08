import { randomUUID } from "node:crypto";
import { env } from "~/env";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { CompanyResearchWorkflowService } from "~/server/application/intelligence/company-research-workflow-service";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { QuickResearchWorkflowService } from "~/server/application/intelligence/quick-research-workflow-service";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { TimingFeedbackService } from "~/server/application/timing/timing-feedback-service";
import { PositionContextService } from "~/server/application/timing/position-context-service";
import { TimingReviewSchedulingService } from "~/server/application/timing/timing-review-scheduling-service";
import { WatchlistPortfolioManagerService } from "~/server/application/timing/watchlist-portfolio-manager-service";
import { WatchlistRiskManagerService } from "~/server/application/timing/watchlist-risk-manager-service";
import { db } from "~/server/db";
import { InsightQualityService } from "~/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/server/domain/intelligence/services/review-plan-policy";
import { TimingActionPolicy } from "~/server/domain/timing/services/timing-action-policy";
import { TimingConfidencePolicy } from "~/server/domain/timing/services/timing-confidence-policy";
import { TimingReviewPolicy } from "~/server/domain/timing/services/timing-review-policy";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
import { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import { PrismaTimingFeedbackObservationRepository } from "~/server/infrastructure/timing/prisma-timing-feedback-observation-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";
import { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import { PrismaTimingRecommendationRepository } from "~/server/infrastructure/timing/prisma-timing-recommendation-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import {
  QuickResearchContractLangGraph,
  QuickResearchLangGraph,
  QuickResearchODRLangGraph,
} from "~/server/infrastructure/workflow/langgraph/quick-research-graph";
import { TimingSignalPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-signal-graph";
import { TimingReviewLoopLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-review-loop-graph";
import { WatchlistTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-cards-graph";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

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
    new QuickResearchLangGraph(
      new IntelligenceAgentService({
        deepSeekClient,
        dataClient: pythonDataClient,
        confidenceAnalysisService,
      }),
    ),
    new QuickResearchODRLangGraph(quickResearchWorkflowService),
    new QuickResearchContractLangGraph(quickResearchWorkflowService),
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
