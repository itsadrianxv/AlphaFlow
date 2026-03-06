import { WorkflowEventType } from "~/generated/prisma";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import type {
  QuickResearchGraphState,
  QuickResearchNodeKey,
  WorkflowEventStreamType,
} from "~/server/domain/workflow/types";
import { QUICK_RESEARCH_NODE_KEYS } from "~/server/domain/workflow/types";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { ScreeningFacade } from "~/server/application/screening/screening-facade";
import { QuickResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/quick-research-graph";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

class RunCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCancelledError";
  }
}

function mapEventType(eventType: WorkflowEventType): WorkflowEventStreamType | null {
  switch (eventType) {
    case WorkflowEventType.RUN_STARTED:
      return "RUN_STARTED";
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

function getNodeOutput(
  nodeKey: QuickResearchNodeKey,
  state: QuickResearchGraphState,
): Record<string, unknown> {
  if (nodeKey === "agent1_industry_overview") {
    return {
      intent: state.intent,
      industryOverview: state.industryOverview,
    };
  }

  if (nodeKey === "agent2_market_heat") {
    return {
      heatAnalysis: state.heatAnalysis,
    };
  }

  if (nodeKey === "agent3_candidate_screening") {
    return {
      candidates: state.candidates,
    };
  }

  if (nodeKey === "agent4_credibility_batch") {
    return {
      credibility: state.credibility,
    };
  }

  return {
    competition: state.competition,
    finalReport: state.finalReport,
  };
}

export type WorkflowExecutionServiceDependencies = {
  repository: PrismaWorkflowRunRepository;
  runtimeStore: RedisWorkflowRuntimeStore;
  graph: QuickResearchLangGraph;
};

export function createWorkflowExecutionService(repository: PrismaWorkflowRunRepository) {
  const intelligenceService = new IntelligenceAgentService({
    deepSeekClient: new DeepSeekClient(),
    dataClient: new PythonIntelligenceDataClient(),
    screeningFacade: new ScreeningFacade(),
  });

  return new WorkflowExecutionService({
    repository,
    runtimeStore: new RedisWorkflowRuntimeStore(),
    graph: new QuickResearchLangGraph(intelligenceService),
  });
}

export class WorkflowExecutionService {
  private readonly repository: PrismaWorkflowRunRepository;
  private readonly runtimeStore: RedisWorkflowRuntimeStore;
  private readonly graph: QuickResearchLangGraph;

  constructor(dependencies: WorkflowExecutionServiceDependencies) {
    this.repository = dependencies.repository;
    this.runtimeStore = dependencies.runtimeStore;
    this.graph = dependencies.graph;
  }

  async executeRecoverableRunningRun(workerId: string) {
    const runningRuns = await this.repository.listRunningRuns(10);

    for (const run of runningRuns) {
      const checkpoint = await this.runtimeStore.loadCheckpoint(run.id);

      if (!checkpoint) {
        continue;
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

  private async executeRun(runId: string, workerId: string, recovering: boolean) {
    const run = await this.repository.getRunById(runId);

    if (!run) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND,
        `工作流运行不存在: ${runId}`,
      );
    }

    if (await this.repository.isCancellationRequested(runId)) {
      await this.repository.markRunCancelled({
        runId,
        reason: "cancelled_before_execution",
      });
      await this.publishLatestEvent(runId, run.progressPercent, run.currentNodeKey ?? undefined);
      return;
    }

    const checkpoint = await this.runtimeStore.loadCheckpoint(runId);
    let startNodeIndex = 0;

    let state: QuickResearchGraphState = checkpoint ?? {
      runId,
      userId: run.userId,
      query: run.query,
      progressPercent: run.progressPercent,
      currentNodeKey: undefined,
      errors: [],
    };

    if (checkpoint?.currentNodeKey) {
      const checkpointNodeIndex = QUICK_RESEARCH_NODE_KEYS.findIndex(
        (nodeKey) => nodeKey === checkpoint.currentNodeKey,
      );

      if (checkpointNodeIndex >= 0) {
        startNodeIndex = checkpointNodeIndex + 1;
      }
    }

    const nodeRunIds = new Map<QuickResearchNodeKey, string>();
    const nodeStartedAt = new Map<QuickResearchNodeKey, number>();

    try {
      const executedState = await this.graph.execute({
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
              },
            });

            nodeRunIds.set(nodeKey, nodeRun.id);
            nodeStartedAt.set(nodeKey, Date.now());

            await this.repository.updateRunProgress({
              runId,
              currentNodeKey: nodeKey,
              progressPercent: state.progressPercent,
            });

            await this.publishLatestEvent(runId, state.progressPercent, nodeKey);
          },
          onNodeProgress: async (nodeKey, payload) => {
            const nodeRunId = nodeRunIds.get(nodeKey);
            await this.repository.addNodeProgressEvent({
              runId,
              nodeRunId,
              nodeKey,
              payload,
            });
            await this.publishLatestEvent(runId, state.progressPercent, nodeKey);
          },
          onNodeSucceeded: async (nodeKey, updatedState) => {
            const startedAt = nodeStartedAt.get(nodeKey) ?? Date.now();
            const durationMs = Date.now() - startedAt;
            const nodeRunId = nodeRunIds.get(nodeKey);

            if (!nodeRunId) {
              throw new WorkflowDomainError(
                WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED,
                `节点执行记录缺失: ${nodeKey}`,
              );
            }

            await this.repository.markNodeSucceeded({
              runId,
              nodeRunId,
              nodeKey,
              output: getNodeOutput(nodeKey, updatedState),
              durationMs,
            });

            await this.repository.updateRunProgress({
              runId,
              currentNodeKey: nodeKey,
              progressPercent: updatedState.progressPercent,
            });

            await this.runtimeStore.saveCheckpoint(runId, updatedState);
            await this.publishLatestEvent(runId, updatedState.progressPercent, nodeKey);

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
        result: (state.finalReport ?? {
          generatedAt: new Date().toISOString(),
        }) as Record<string, unknown>,
      });

      await this.runtimeStore.clearCheckpoint(runId);
      await this.publishLatestEvent(runId, 100, state.currentNodeKey);
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await this.repository.markRunCancelled({
          runId,
          reason: error.message,
        });
        await this.publishLatestEvent(runId, state.progressPercent, state.currentNodeKey);
        return;
      }

      const errorCode =
        error instanceof WorkflowDomainError
          ? error.code
          : WORKFLOW_ERROR_CODES.WORKFLOW_NODE_EXECUTION_FAILED;
      const errorMessage = error instanceof Error ? error.message : "未知执行错误";

      if (state.currentNodeKey) {
        const nodeRunId = nodeRunIds.get(state.currentNodeKey);

        if (nodeRunId) {
          await this.repository.markNodeFailed({
            runId,
            nodeRunId,
            nodeKey: state.currentNodeKey,
            errorCode,
            errorMessage,
            durationMs: Date.now() - (nodeStartedAt.get(state.currentNodeKey) ?? Date.now()),
          });
          await this.publishLatestEvent(runId, state.progressPercent, state.currentNodeKey);
        }
      }

      await this.repository.markRunFailed({
        runId,
        errorCode,
        errorMessage,
      });
      await this.publishLatestEvent(runId, state.progressPercent, state.currentNodeKey);
    }
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
      nodeKey: payloadNodeKey as QuickResearchNodeKey | undefined,
      progressPercent,
      timestamp: latestEvent.occurredAt.toISOString(),
      payload,
    });
  }
}
