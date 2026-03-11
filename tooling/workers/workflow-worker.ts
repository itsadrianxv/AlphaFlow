import { randomUUID } from "node:crypto";
import { env } from "~/env";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
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
import { FirecrawlClient } from "~/server/infrastructure/intelligence/firecrawl-client";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PrismaScreeningInsightRepository } from "~/server/infrastructure/intelligence/prisma-screening-insight-repository";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
import { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";
import { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import { PrismaTimingRecommendationRepository } from "~/server/infrastructure/timing/prisma-timing-recommendation-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import { CompanyResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import { QuickResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/quick-research-graph";
import { ScreeningInsightPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/screening-insight-pipeline-graph";
import { ScreeningToTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/screening-to-timing-graph";
import { TimingSignalPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-signal-graph";
import { TimingReviewLoopLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-review-loop-graph";
import { WatchlistTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-cards-graph";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";
import { PrismaScreeningSessionRepository } from "~/server/infrastructure/screening/prisma-screening-session-repository";

const workflowRepository = new PrismaWorkflowRunRepository(db);
const deepSeekClient = new DeepSeekClient();
const pythonDataClient = new PythonIntelligenceDataClient();
const confidenceAnalysisService = new ConfidenceAnalysisService({
  client: new PythonConfidenceAnalysisClient(),
});
const reminderRepository = new PrismaResearchReminderRepository(db);
const insightRepository = new PrismaScreeningInsightRepository(db);
const screeningSessionRepository = new PrismaScreeningSessionRepository(db);
const watchListRepository = new PrismaWatchListRepository(db);
const portfolioSnapshotRepository = new PrismaPortfolioSnapshotRepository(db);
const timingPresetRepository = new PrismaTimingPresetRepository(db);
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
const watchlistPortfolioManagerService =
  new WatchlistPortfolioManagerService();
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
    new CompanyResearchLangGraph(
      new CompanyResearchAgentService({
        deepSeekClient,
        firecrawlClient: new FirecrawlClient(),
        confidenceAnalysisService,
      }),
    ),
    new ScreeningInsightPipelineLangGraph({
      screeningSessionRepository,
      insightRepository,
      dataClient: pythonDataClient,
      synthesisService,
      confidenceAnalysisService,
      reminderSchedulingService,
    }),
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
      marketRegimeService,
      riskManagerService: watchlistRiskManagerService,
      portfolioManagerService: watchlistPortfolioManagerService,
      recommendationRepository: timingRecommendationRepository,
      reviewSchedulingService: timingReviewSchedulingService,
    }),
    new ScreeningToTimingPipelineLangGraph({
      screeningSessionRepository,
      presetRepository: timingPresetRepository,
      timingDataClient: pythonTimingDataClient,
      analysisService: timingAnalysisService,
      signalSnapshotRepository: timingSignalSnapshotRepository,
      analysisCardRepository: timingAnalysisCardRepository,
      reviewSchedulingService: timingReviewSchedulingService,
    }),
    new TimingReviewLoopLangGraph({
      timingDataClient: pythonTimingDataClient,
      reviewRecordRepository: timingReviewRecordRepository,
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
