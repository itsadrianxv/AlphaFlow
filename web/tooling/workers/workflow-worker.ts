import { randomUUID } from "node:crypto";
import { env } from "~/env";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { CompanyResearchWorkflowService } from "~/server/application/intelligence/company-research-workflow-service";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { IndustryResearchWorkflowService } from "~/server/application/intelligence/industry-research-workflow-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import { KronosForecastWorkflowService } from "~/server/application/timing/kronos-forecast-workflow-service";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { PositionContextService } from "~/server/application/timing/position-context-service";
import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { TimingFeedbackService } from "~/server/application/timing/timing-feedback-service";
import { TimingReviewSchedulingService } from "~/server/application/timing/timing-review-scheduling-service";
import { WatchlistPortfolioManagerService } from "~/server/application/timing/watchlist-portfolio-manager-service";
import { WatchlistRiskManagerService } from "~/server/application/timing/watchlist-risk-manager-service";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import { db } from "~/server/db";
import { TimingActionPolicy } from "~/server/domain/timing/services/timing-action-policy";
import { TimingConfidencePolicy } from "~/server/domain/timing/services/timing-confidence-policy";
import { TimingReviewPolicy } from "~/server/domain/timing/services/timing-review-policy";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
import { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import { PrismaTimingFeedbackObservationRepository } from "~/server/infrastructure/timing/prisma-timing-feedback-observation-repository";
import { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import { PrismaTimingRecommendationRepository } from "~/server/infrastructure/timing/prisma-timing-recommendation-repository";
import { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import { IndustryResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/industry-research-graph";
import { PiAgentRuntimeLangGraph } from "~/server/infrastructure/workflow/langgraph/pi-agent-runtime-graph";
import { TimingReviewLoopLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-review-loop-graph";
import { TimingSignalPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-signal-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-cards-graph";
import { WatchlistTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-graph";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

const workflowRepository = new PrismaWorkflowRunRepository(db);
const agentRuntimeRepository = new PrismaAgentRuntimeRepository(db);
const agentConversationRepository = new PrismaAgentConversationRepository(db);
const agentRuntimeClient = new AgentRuntimeClient();
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
const industryResearchWorkflowService = new IndustryResearchWorkflowService({
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
const timingSignalSnapshotRepository = new PrismaTimingSignalSnapshotRepository(
  db,
);
const timingAnalysisCardRepository = new PrismaTimingAnalysisCardRepository(db);
const timingRecommendationRepository = new PrismaTimingRecommendationRepository(
  db,
);
const kronosForecastSnapshotRepository =
  new PrismaTimingKronosForecastSnapshotRepository(db);
const reminderSchedulingService = new ReminderSchedulingService({
  reminderRepository,
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
const kronosForecastWorkflowService = new KronosForecastWorkflowService({
  client: new KronosForecastClient(),
  snapshotRepository: kronosForecastSnapshotRepository,
});
const timingReviewSchedulingService = new TimingReviewSchedulingService({
  reviewRecordRepository: timingReviewRecordRepository,
  reminderSchedulingService,
});
const executionService = new WorkflowExecutionService({
  repository: workflowRepository,
  runtimeStore: new RedisWorkflowRuntimeStore(),
  graphs: [
    new IndustryResearchLangGraph(industryResearchWorkflowService),
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
      kronosForecastWorkflowService,
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
      kronosForecastWorkflowService,
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
    new PiAgentRuntimeLangGraph({
      agentRuntimeClient,
      agentRuntimeRepository,
      agentConversationRepository,
    }),
  ],
});

const workerId =
  process.env.WORKFLOW_WORKER_ID ?? `workflow-worker-${randomUUID()}`;
const pollIntervalMs = env.WORKFLOW_WORKER_POLL_INTERVAL_MS;
const concurrency = env.WORKFLOW_WORKER_CONCURRENCY;

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
  console.info(
    `[workflow-worker] started: ${workerId} (concurrency=${concurrency})`,
  );

  // 先恢复遗留的运行中任务，避免启动并发槽位后重复恢复同一个任务。
  while (!shuttingDown) {
    try {
      const recovered =
        await executionService.executeRecoverableRunningRun(workerId);

      if (recovered) {
        continue;
      }
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[workflow-worker] loop error: ${message}`);
      await sleep(pollIntervalMs);
    }
  }

  const runSlot = async (slot: number) => {
    while (!shuttingDown) {
      try {
        const picked = await executionService.executeNextPendingRun(workerId);

        if (!picked) {
          // 仅在没有任务时轮询，避免空队列时持续占用数据库连接。
          await sleep(pollIntervalMs);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        console.error(`[workflow-worker] slot ${slot} error: ${message}`);
        await sleep(pollIntervalMs);
      }
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => runSlot(index + 1)),
  );
}

void main();
