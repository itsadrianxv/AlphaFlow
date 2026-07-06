import { WorkflowEventType, WorkflowNodeRunStatus } from "@prisma/client";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { CompanyResearchWorkflowService } from "~/server/application/intelligence/company-research-workflow-service";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { QuickResearchWorkflowService } from "~/server/application/intelligence/quick-research-workflow-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import { InsightQualityService } from "~/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/server/domain/intelligence/services/review-plan-policy";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
  WorkflowPauseError,
} from "~/server/domain/workflow/errors";
import type {
  WorkflowEventStreamType,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PrismaScreeningInsightRepository } from "~/server/infrastructure/intelligence/prisma-screening-insight-repository";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaScreeningSessionRepository } from "~/server/infrastructure/screening/prisma-screening-session-repository";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import { WorkflowGraphRegistry } from "~/server/infrastructure/workflow/langgraph/graph-registry";
import { QuickResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/quick-research-graph";
import { ScreeningInsightPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/screening-insight-pipeline-graph";
import type { WorkflowGraphRunner } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

class RunCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCancelledError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapEventType(
  eventType: WorkflowEventType,
): WorkflowEventStreamType | null {
  switch (eventType) {
    case WorkflowEventType.RUN_STARTED:
      return "RUN_STARTED";
    case WorkflowEventType.RUN_PAUSED:
      return "RUN_PAUSED";
    case WorkflowEventType.RUN_RESUMED:
      return "RUN_RESUMED";
    case WorkflowEventType.RUN_SUCCEEDED:
      return "RUN_SUCCEEDED";
    case WorkflowEventType.RUN_FAILED:
      return "RUN_FAILED";
    case WorkflowEventType.RUN_CANCELLED:
      return "RUN_CANCELLED";
    case WorkflowEventType.NODE_STARTED:
      return "NODE_STARTED";
    case WorkflowEventType.NODE_PROGRESS:
      return "NODE_PROGRESS";
    case WorkflowEventType.NODE_SUCCEEDED:
      return "NODE_SUCCEEDED";
    case WorkflowEventType.NODE_FAILED:
      return "NODE_FAILED";
    default:
      return null;
  }
}

export type WorkflowExecutionServiceDependencies = {
  repository: PrismaWorkflowRunRepository;
  runtimeStore: RedisWorkflowRuntimeStore;
  graphs: WorkflowGraphRunner[];
};

export function createWorkflowExecutionService(
  repository: PrismaWorkflowRunRepository,
  options?: {
    runtimeStore?: RedisWorkflowRuntimeStore;
    graphs?: WorkflowGraphRunner[];
  },
) {
  const prisma = repository.getPrismaClient();
  const deepSeekClient = new DeepSeekClient();
  const intelligenceDataClient = new PythonIntelligenceDataClient();
  const capabilityGatewayClient = new PythonCapabilityGatewayClient();
  const confidenceAnalysisService = new ConfidenceAnalysisService({
    client: new PythonConfidenceAnalysisClient(),
  });
  const intelligenceService = new IntelligenceAgentService({
    deepSeekClient,
    dataClient: intelligenceDataClient,
    confidenceAnalysisService,
  });
  const companyResearchService = new CompanyResearchAgentService({
    deepSeekClient,
    pythonCapabilityGatewayClient: capabilityGatewayClient,
    pythonIntelligenceDataClient: intelligenceDataClient,
    confidenceAnalysisService,
  });
  const researchToolRegistry = new ResearchToolRegistry({
    deepSeekClient,
    pythonCapabilityGatewayClient: capabilityGatewayClient,
    pythonIntelligenceDataClient: intelligenceDataClient,
  });
  const quickResearchWorkflowService = new QuickResearchWorkflowService({
    client: deepSeekClient,
    intelligenceService,
  });
  const companyResearchWorkflowService = new CompanyResearchWorkflowService({
    client: deepSeekClient,
    companyResearchService,
    researchToolRegistry,
  });
  const reminderRepository = new PrismaResearchReminderRepository(prisma);
  const reminderSchedulingService = new ReminderSchedulingService({
    reminderRepository,
  });
  const synthesisService = new InsightSynthesisService({
    completionClient: deepSeekClient,
    reviewPlanPolicy: new ReviewPlanPolicy(),
    qualityService: new InsightQualityService(),
  });

  return new WorkflowExecutionService({
    repository,
    runtimeStore: options?.runtimeStore ?? new RedisWorkflowRuntimeStore(),
    graphs: options?.graphs ?? [
      new QuickResearchLangGraph(quickResearchWorkflowService),
      new LegacyCompanyResearchLangGraph(companyResearchService),
      new CompanyResearchLangGraph(companyResearchService),
      new ODRCompanyResearchLangGraph(companyResearchWorkflowService),
      new CompanyResearchContractLangGraph(companyResearchWorkflowService),
      new ScreeningInsightPipelineLangGraph({
        screeningSessionRepository: new PrismaScreeningSessionRepository(
          prisma,
        ),
        insightRepository: new PrismaScreeningInsightRepository(prisma),
        dataClient: intelligenceDataClient,
        synthesisService,
        confidenceAnalysisService,
        reminderSchedulingService,
      }),
    ],
  });
}

export class WorkflowExecutionService {
  private readonly repository: PrismaWorkflowRunRepository;
  private readonly runtimeStore: RedisWorkflowRuntimeStore;
  private readonly graphRegistry: WorkflowGraphRegistry;

  constructor(dependencies: WorkflowExecutionServiceDependencies) {
    this.repository = dependencies.repository;
    this.runtimeStore = dependencies.runtimeStore;
    this.graphRegistry = new WorkflowGraphRegistry(dependencies.graphs);
  }

  async executeRecoverableRunningRun(workerId: string) {
    const runningRuns = await this.repository.listRunningRuns(10);

    for (const run of runningRuns) {
      const checkpoint = await this.runtimeStore.loadCheckpoint(run.id);

      if (!checkpoint) {
        const runDetail = await this.repository.getRunById(run.id);
        const hasCompletedNodes =
          runDetail?.nodeRuns.some(
            (nodeRun) =>
              nodeRun.status === WorkflowNodeRunStatus.SUCCEEDED ||
              nodeRun.status === WorkflowNodeRunStatus.SKIPPED,
          ) ?? false;

        if (!hasCompletedNodes) {
          continue;
        }
      }

      await this.executeRun(run.id, workerId, true);
      return true;
    }

    return false;
  }

  async executeNextPendingRun(workerId: string) {
    const run = await this.repository.claimNextPendingRun(workerId);

    if (!run) {
      return false;
    }

    await this.publishLatestEvent(run.id, 0);
    await this.executeRun(run.id, workerId, false);
    return true;
  }

  private async executeRun(
    runId: string,
    workerId: string,
    recovering: boolean,
  ) {
    const run = await this.repository.getRunById(runId);

    if (!run) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND,
        `宸ヤ綔娴佽繍琛屼笉瀛樺湪: ${runId}`,
      );
    }

    const graph = this.graphRegistry.get(
      run.template.code,
      run.template.version,
    );

    if (await this.repository.isCancellationRequested(runId)) {
      await this.repository.markRunCancelled({
        runId,
        reason: "cancelled_before_execution",
      });
      await this.publishLatestEvent(
        runId,
        run.progressPercent,
        run.currentNodeKey ?? undefined,
      );
      return;
    }

    const checkpoint = await this.runtimeStore.loadCheckpoint(runId);
    let state: WorkflowGraphState =
      checkpoint ??
      graph.buildInitialState({
        runId,
        userId: run.userId,
        query: run.query,
        input: ((run.input ?? {}) as Record<string, unknown>) ?? {},
        progressPercent: run.progressPercent,
        templateGraphConfig: run.template.graphConfig,
      });

    state = this.restoreStateFromCompletedNodeRuns(graph, state, run.nodeRuns);

    let startNodeIndex = 0;
    const resumeNodeKey = state.lastCompletedNodeKey ?? state.currentNodeKey;

    if (resumeNodeKey) {
      const checkpointNodeIndex = graph.getNodeOrder().indexOf(resumeNodeKey);

      if (checkpointNodeIndex >= 0) {
        startNodeIndex = checkpointNodeIndex + 1;
      }
    }

    const existingNodeRunIds = new Map<WorkflowNodeKey, string>(
      run.nodeRuns.map((nodeRun) => [nodeRun.nodeKey, nodeRun.id]),
    );
    const nodeRunIds = new Map<WorkflowNodeKey, string>();
    const nodeStartedAt = new Map<WorkflowNodeKey, number>();
    let activeNodeKey: WorkflowNodeKey | undefined =
      typeof state.currentNodeKey === "string"
        ? state.currentNodeKey
        : undefined;

    try {
      const executedState = await graph.execute({
        initialState: state,
        startNodeIndex,
        hooks: {
          onNodeStarted: async (nodeKey) => {
            if (await this.repository.isCancellationRequested(runId)) {
              throw new RunCancelledError("用户已请求取消");
            }

            const nodeRun = await this.repository.markNodeStarted({
              runId,
              nodeKey,
              agentName: nodeKey,
              attempt: 1,
              input: {
                query: state.query,
                nodeKey,
                recovering,
                workerId,
                templateCode: run.template.code,
              },
            });

            existingNodeRunIds.set(nodeKey, nodeRun.id);
            nodeRunIds.set(nodeKey, nodeRun.id);
            nodeStartedAt.set(nodeKey, Date.now());
            activeNodeKey = nodeKey;
            state = {
              ...state,
              currentNodeKey: nodeKey,
            };

            await this.repository.updateRunProgress({
              runId,
              currentNodeKey: nodeKey,
              progressPercent: state.progressPercent,
            });

            await this.publishLatestEvent(
              runId,
              state.progressPercent,
              nodeKey,
            );
          },
          onNodeProgress: async (nodeKey, payload) => {
            const nodeRunId =
              nodeRunIds.get(nodeKey) ?? existingNodeRunIds.get(nodeKey);

            await this.repository.addNodeProgressEvent({
              runId,
              nodeRunId,
              nodeKey,
              payload,
            });
            await this.publishLatestEvent(
              runId,
              state.progressPercent,
              nodeKey,
            );
          },
          onNodeSkipped: async (nodeKey, updatedState, payload) => {
            const nodeRunId =
              existingNodeRunIds.get(nodeKey) ??
              (await this.repository.findNodeRun(runId, nodeKey, 1))?.id;

            if (!nodeRunId) {
              throw new WorkflowDomainError(
                WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
                `鑺傜偣璺宠繃璁板綍缂哄け: ${nodeKey}`,
              );
            }

            await this.repository.markNodeSkipped({
              runId,
              nodeRunId,
              nodeKey,
              output: graph.getNodeOutput(nodeKey, updatedState),
              durationMs: 0,
              reason: String(payload.reason ?? "skipped"),
              eventPayload: payload,
            });

            await this.repository.updateRunProgress({
              runId,
              currentNodeKey: nodeKey,
              progressPercent: updatedState.progressPercent,
            });

            await this.runtimeStore.saveCheckpoint(runId, updatedState);
            await this.publishLatestEvent(
              runId,
              updatedState.progressPercent,
              nodeKey,
            );

            if (activeNodeKey === nodeKey) {
              activeNodeKey = undefined;
            }
            state = updatedState;
          },
          onNodeSucceeded: async (nodeKey, updatedState) => {
            const startedAt = nodeStartedAt.get(nodeKey) ?? Date.now();
            const durationMs = Date.now() - startedAt;
            const nodeRunId =
              nodeRunIds.get(nodeKey) ?? existingNodeRunIds.get(nodeKey);

            if (!nodeRunId) {
              throw new WorkflowDomainError(
                WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
                `鑺傜偣鎵ц璁板綍缂哄け: ${nodeKey}`,
              );
            }

            await this.repository.markNodeSucceeded({
              runId,
              nodeRunId,
              nodeKey,
              output: graph.getNodeOutput(nodeKey, updatedState),
              durationMs,
              eventPayload: graph.getNodeEventPayload(nodeKey, updatedState),
            });

            await this.repository.updateRunProgress({
              runId,
              currentNodeKey: nodeKey,
              progressPercent: updatedState.progressPercent,
            });

            await this.runtimeStore.saveCheckpoint(runId, updatedState);
            await this.publishLatestEvent(
              runId,
              updatedState.progressPercent,
              nodeKey,
            );

            if (activeNodeKey === nodeKey) {
              activeNodeKey = undefined;
            }
            state = updatedState;

            if (await this.repository.isCancellationRequested(runId)) {
              throw new RunCancelledError("用户已请求取消");
            }
          },
        },
      });

      state = executedState;

      if (await this.repository.isCancellationRequested(runId)) {
        throw new RunCancelledError("用户已请求取消");
      }

      await this.repository.markRunSucceeded({
        runId,
        result: graph.getRunResult(state),
      });

      await this.runtimeStore.clearCheckpoint(runId);
      await this.publishLatestEvent(runId, 100, state.currentNodeKey);
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await this.repository.markRunCancelled({
          runId,
          reason: error.message,
        });
        await this.publishLatestEvent(
          runId,
          state.progressPercent,
          activeNodeKey ?? state.currentNodeKey,
        );
        return;
      }

      if (error instanceof WorkflowPauseError) {
        const pausedState =
          error.state && isRecord(error.state)
            ? ({
                ...state,
                ...error.state,
              } as WorkflowGraphState)
            : state;
        const pausedNodeKey =
          typeof pausedState.currentNodeKey === "string"
            ? pausedState.currentNodeKey
            : undefined;

        state = pausedState;

        await this.runtimeStore.saveCheckpoint(runId, pausedState);
        await this.repository.markRunPaused({
          runId,
          currentNodeKey: pausedNodeKey,
          progressPercent: pausedState.progressPercent,
          reason: error.reason,
          eventPayload: pausedNodeKey
            ? graph.getNodeEventPayload(pausedNodeKey, pausedState)
            : {},
        });
        await this.publishLatestEvent(
          runId,
          pausedState.progressPercent,
          pausedNodeKey,
        );
        return;
      }

      const errorCode =
        error instanceof WorkflowDomainError
          ? error.code
          : WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED;
      const errorMessage =
        error instanceof Error ? error.message : "鏈煡鎵ц閿欒";

      const failedNodeKey =
        activeNodeKey ??
        (typeof state.currentNodeKey === "string"
          ? state.currentNodeKey
          : undefined);

      if (failedNodeKey) {
        const nodeRunId =
          nodeRunIds.get(failedNodeKey) ??
          existingNodeRunIds.get(failedNodeKey);

        if (nodeRunId) {
          await this.repository.markNodeFailed({
            runId,
            nodeRunId,
            nodeKey: failedNodeKey,
            errorCode,
            errorMessage,
            durationMs:
              Date.now() - (nodeStartedAt.get(failedNodeKey) ?? Date.now()),
          });
          await this.publishLatestEvent(
            runId,
            state.progressPercent,
            failedNodeKey,
          );
        }
      }

      await this.repository.markRunFailed({
        runId,
        errorCode,
        errorMessage,
      });
      await this.publishLatestEvent(
        runId,
        state.progressPercent,
        failedNodeKey,
      );
    }
  }

  private restoreStateFromCompletedNodeRuns(
    graph: WorkflowGraphRunner,
    baseState: WorkflowGraphState,
    nodeRuns: Array<{
      nodeKey: string;
      status: WorkflowNodeRunStatus;
      output: unknown;
    }>,
  ) {
    const nodeOrder = graph.getNodeOrder();
    let state = baseState;

    const completedNodeRuns = nodeRuns
      .filter(
        (nodeRun) =>
          nodeRun.status === WorkflowNodeRunStatus.SUCCEEDED ||
          nodeRun.status === WorkflowNodeRunStatus.SKIPPED,
      )
      .sort(
        (left, right) =>
          nodeOrder.indexOf(left.nodeKey) - nodeOrder.indexOf(right.nodeKey),
      );

    for (const nodeRun of completedNodeRuns) {
      const nodeIndex = nodeOrder.indexOf(nodeRun.nodeKey);

      if (nodeIndex < 0) {
        continue;
      }

      state = graph.mergeNodeOutput(
        state,
        nodeRun.nodeKey,
        isRecord(nodeRun.output) ? nodeRun.output : {},
      );
      state = {
        ...state,
        currentNodeKey: nodeRun.nodeKey,
        lastCompletedNodeKey: nodeRun.nodeKey,
        progressPercent: Math.max(
          state.progressPercent,
          Math.round(((nodeIndex + 1) / nodeOrder.length) * 100),
        ),
      };
    }

    return state;
  }

  private async publishLatestEvent(
    runId: string,
    progressPercent: number,
    nodeKey?: string,
  ) {
    const latestEvent = await this.repository.getLatestEvent(runId);

    if (!latestEvent) {
      return;
    }

    const eventType = mapEventType(latestEvent.eventType);

    if (!eventType) {
      return;
    }

    const payload = (latestEvent.payload ?? {}) as Record<string, unknown>;
    const payloadNodeKey =
      typeof payload.nodeKey === "string" ? payload.nodeKey : nodeKey;

    await this.runtimeStore.publishEvent({
      runId,
      sequence: latestEvent.sequence,
      type: eventType,
      nodeKey: payloadNodeKey,
      progressPercent,
      timestamp: latestEvent.occurredAt.toISOString(),
      payload,
    });
  }
}
