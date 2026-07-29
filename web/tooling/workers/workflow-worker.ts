import { randomUUID } from "node:crypto";
import { env } from "~/env";
import { EvidenceAwareLlmClient } from "~/server/application/evidence-context/evidence-aware-llm-client";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { CompanyResearchWorkflowService } from "~/server/application/intelligence/company-research-workflow-service";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { ImpactMappingService } from "~/server/application/intelligence/impact-mapping-service";
import { IndustryResearchWorkflowService } from "~/server/application/intelligence/industry-research-workflow-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import { SharedNewsLibraryService } from "~/server/application/intelligence/shared-news-library-service";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import { db } from "~/server/db";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import { ImpactMappingLangGraph } from "~/server/infrastructure/workflow/langgraph/impact-mapping-graph";
import { IndustryResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/industry-research-graph";
import { PiAgentRuntimeLangGraph } from "~/server/infrastructure/workflow/langgraph/pi-agent-runtime-graph";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

const workflowRepository = new PrismaWorkflowRunRepository(db);
const agentRuntimeRepository = new PrismaAgentRuntimeRepository(db);
const agentConversationRepository = new PrismaAgentConversationRepository(db);
const agentRuntimeClient = new AgentRuntimeClient();
const deepSeekClient = new DeepSeekClient();
const pythonDataClient = new PythonIntelligenceDataClient();
const sharedNewsLibraryService = new SharedNewsLibraryService(
  db,
  pythonDataClient,
);
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
const evidenceContextRepository = new PrismaEvidenceContextRepository(db);
const impactMappingService = new ImpactMappingService({
  prisma: db,
  dataClient: pythonDataClient,
  sharedNewsLibraryService,
  capabilityClient: capabilityGatewayClient,
  evidenceRepository: evidenceContextRepository,
  evidenceAwareLlmClient: new EvidenceAwareLlmClient(
    deepSeekClient,
    evidenceContextRepository,
  ),
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
const executionService = new WorkflowExecutionService({
  repository: workflowRepository,
  runtimeStore: new RedisWorkflowRuntimeStore(),
  graphs: [
    new IndustryResearchLangGraph(industryResearchWorkflowService),
    new ImpactMappingLangGraph(impactMappingService),
    new CompanyResearchLangGraph(companyResearchService),
    new LegacyCompanyResearchLangGraph(companyResearchService),
    new ODRCompanyResearchLangGraph(companyResearchWorkflowService),
    new CompanyResearchContractLangGraph(companyResearchWorkflowService),
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

  const recoverLegacyRuns = async () => {
    while (!shuttingDown) {
      try {
        const recovered =
          await executionService.executeRecoverableRunningRun(workerId);

        if (!recovered) {
          await sleep(pollIntervalMs);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        console.error(`[workflow-worker] recovery loop error: ${message}`);
        await sleep(pollIntervalMs);
      }
    }
  };

  // 遗留运行恢复不能阻塞新任务槽位；两条循环共享数据库领取锁，彼此独立运行。
  void recoverLegacyRuns();

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
