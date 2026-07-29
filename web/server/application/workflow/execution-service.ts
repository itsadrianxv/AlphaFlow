import { WorkflowEventType, WorkflowNodeRunStatus } from "@prisma/client";
import { attachWorkflowNodeInsight } from "~/contracts/workflow-node-insight";
import { env } from "~/env";
import { EvidenceAwareLlmClient } from "~/server/application/evidence-context/evidence-aware-llm-client";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { CompanyResearchWorkflowService } from "~/server/application/intelligence/company-research-workflow-service";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { ImpactMappingService } from "~/server/application/intelligence/impact-mapping-service";
import { IndustryResearchWorkflowService } from "~/server/application/intelligence/industry-research-workflow-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";
import { SharedNewsLibraryService } from "~/server/application/intelligence/shared-news-library-service";
import { InsightQualityService } from "~/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/server/domain/intelligence/services/review-plan-policy";
import {
  WORKFLOW_ERROR_CODES,
  RunCancelledError,
  WorkflowDomainError,
  WorkflowNodeTimeoutError,
  WorkflowPauseError,
} from "~/server/domain/workflow/errors";
import type {
  WorkflowEventStreamType,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PythonMarketContextClient } from "~/server/infrastructure/intelligence/python-market-context-client";
import {
  CompanyResearchContractLangGraph,
  CompanyResearchLangGraph,
  LegacyCompanyResearchLangGraph,
  ODRCompanyResearchLangGraph,
} from "~/server/infrastructure/workflow/langgraph/company-research-graph";
import { WorkflowGraphRegistry } from "~/server/infrastructure/workflow/langgraph/graph-registry";
import { ImpactMappingLangGraph } from "~/server/infrastructure/workflow/langgraph/impact-mapping-graph";
import { IndustryResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/industry-research-graph";
import { PiAgentRuntimeLangGraph } from "~/server/infrastructure/workflow/langgraph/pi-agent-runtime-graph";
import type { WorkflowGraphRunner } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function supportsNodeInsight(graph: WorkflowGraphRunner) {
  return (
    graph.templateCode === "industry_research" ||
    graph.templateCode === "company_research_center"
  );
}

function getPersistedNodeOutput(params: {
  graph: WorkflowGraphRunner;
  nodeKey: WorkflowNodeKey;
  state: WorkflowGraphState;
}) {
  const output = params.graph.getNodeOutput(params.nodeKey, params.state);
  return supportsNodeInsight(params.graph)
    ? attachWorkflowNodeInsight(output)
    : output;
}

function getPausedNodeEventPayload(params: {
  graph: WorkflowGraphRunner;
  nodeKey: WorkflowNodeKey;
  state: WorkflowGraphState;
}) {
  const payload = params.graph.getNodeEventPayload(
    params.nodeKey,
    params.state,
  );

  if (!supportsNodeInsight(params.graph)) {
    return payload;
  }

  const { nodeKey: _nodeKey, ...insightSource } = payload;
  const output = attachWorkflowNodeInsight(insightSource);
  return output.insight ? { ...payload, insight: output.insight } : payload;
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
  agentConversationRepository?: PrismaAgentConversationRepository;
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
  const sharedNewsLibraryService = new SharedNewsLibraryService(
    prisma,
    intelligenceDataClient,
  );
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
  const evidenceContextWriter = new PrismaEvidenceContextRepository(prisma);
  const evidenceAwareLlmClient = new EvidenceAwareLlmClient(
    deepSeekClient,
    evidenceContextWriter,
  );
  const impactMappingService = new ImpactMappingService({
    prisma,
    dataClient: intelligenceDataClient,
    sharedNewsLibraryService,
    capabilityClient: capabilityGatewayClient,
    marketContextClient: new PythonMarketContextClient(),
    evidenceRepository: evidenceContextWriter,
    evidenceAwareLlmClient,
  });
  const industryResearchWorkflowService = new IndustryResearchWorkflowService({
    client: deepSeekClient,
    intelligenceService,
    evidenceContextWriter,
    evidenceAwareLlmClient,
  });
  const companyResearchWorkflowService = new CompanyResearchWorkflowService({
    client: deepSeekClient,
    companyResearchService,
    researchToolRegistry,
    evidenceContextWriter,
  });
  const agentRuntimeRepository = new PrismaAgentRuntimeRepository(prisma);
  const agentConversationRepository = new PrismaAgentConversationRepository(
    prisma,
  );
  const synthesisService = new InsightSynthesisService({
    completionClient: deepSeekClient,
    reviewPlanPolicy: new ReviewPlanPolicy(),
    qualityService: new InsightQualityService(),
  });

  return new WorkflowExecutionService({
    repository,
    runtimeStore: options?.runtimeStore ?? new RedisWorkflowRuntimeStore(),
    graphs: options?.graphs ?? [
      new IndustryResearchLangGraph(industryResearchWorkflowService),
      new ImpactMappingLangGraph(impactMappingService),
      new LegacyCompanyResearchLangGraph(companyResearchService),
      new CompanyResearchLangGraph(companyResearchService),
      new ODRCompanyResearchLangGraph(companyResearchWorkflowService),
      new CompanyResearchContractLangGraph(companyResearchWorkflowService),
      new PiAgentRuntimeLangGraph({
        agentRuntimeClient: new AgentRuntimeClient(),
        agentRuntimeRepository,
        agentConversationRepository,
      }),
    ],
    agentConversationRepository,
  });
}

export class WorkflowExecutionService {
  private readonly repository: PrismaWorkflowRunRepository;
  private readonly runtimeStore: RedisWorkflowRuntimeStore;
  private readonly graphRegistry: WorkflowGraphRegistry;
  private readonly agentConversationRepository?: PrismaAgentConversationRepository;

  constructor(dependencies: WorkflowExecutionServiceDependencies) {
    this.repository = dependencies.repository;
    this.runtimeStore = dependencies.runtimeStore;
    this.graphRegistry = new WorkflowGraphRegistry(dependencies.graphs);
    this.agentConversationRepository = dependencies.agentConversationRepository;
  }

  async executeRecoverableRunningRun(workerId: string) {
    const runningRuns = await this.repository.listRunningRuns(10);

    for (const run of runningRuns) {
      // A worker may stop after claiming a run but before its first checkpoint.
      // Such a run has no completed nodes, but is still safe to restart from node 1.
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

    const executionAbortController = new AbortController();
    let closeCancellation: () => Promise<void> = async () => undefined;
    try {
      closeCancellation = await this.runtimeStore.subscribeToCancellation(
        runId,
        (payload) => {
          executionAbortController.abort(
            new RunCancelledError(payload.reason || "用户已请求取消"),
          );
        },
        executionAbortController.signal,
      );
    } catch {
      // Redis 订阅不可用时保留数据库边界检查和节点超时兜底。
    }

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
      await closeCancellation();
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

    if (graph.templateCode === "pi_agent_run" && isRecord(run.input)) {
      const currentAgentInput = isRecord(
        (state as Record<string, unknown>).agentInput,
      )
        ? ((state as Record<string, unknown>).agentInput as Record<string, unknown>)
        : {};
      state = {
        ...state,
        agentInput: {
          ...currentAgentInput,
          ...run.input,
        },
        ...(isRecord((state as Record<string, unknown>).preparedTask)
          ? {
              preparedTask: {
                ...((state as Record<string, unknown>).preparedTask as Record<
                  string,
                  unknown
                >),
                ...(typeof run.input.skillId === "string"
                  ? { skillId: run.input.skillId }
                  : {}),
                ...(Array.isArray(run.input.skillIds)
                  ? { skillIds: run.input.skillIds }
                  : {}),
                ...(typeof run.input.prompt === "string"
                  ? { prompt: run.input.prompt }
                  : {}),
                ...(typeof run.input.userMessageId === "string"
                  ? { userMessageId: run.input.userMessageId }
                  : {}),
                ...(typeof run.input.assistantMessageId === "string"
                  ? { assistantMessageId: run.input.assistantMessageId }
                  : {}),
              },
            }
          : {}),
      };
    }

    let startNodeIndex = 0;
    const waitingNode = run.nodeRuns.find(
      (nodeRun) => nodeRun.status === WorkflowNodeRunStatus.WAITING_FOR_INPUT,
    );
    const resumeNodeKey =
      waitingNode?.nodeKey ?? state.lastCompletedNodeKey ?? state.currentNodeKey;

    if (resumeNodeKey) {
      const checkpointNodeIndex = graph.getNodeOrder().indexOf(resumeNodeKey);

      if (checkpointNodeIndex >= 0) {
        startNodeIndex = waitingNode ? checkpointNodeIndex : checkpointNodeIndex + 1;
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
    let nodeTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutError: WorkflowNodeTimeoutError | undefined;
    let rejectNodeTimeout: ((reason: unknown) => void) | undefined;
    const nodeTimeoutPromise = new Promise<never>((_, reject) => {
      rejectNodeTimeout = reject;
    });
    const clearNodeTimeout = () => {
      if (nodeTimeoutTimer !== undefined) {
        clearTimeout(nodeTimeoutTimer);
        nodeTimeoutTimer = undefined;
      }
    };
    const assertNotTimedOut = () => {
      if (timeoutError) {
        throw timeoutError;
      }
    };
    const startNodeTimeout = (nodeKey: WorkflowNodeKey) => {
      clearNodeTimeout();
      nodeTimeoutTimer = setTimeout(() => {
        timeoutError = new WorkflowNodeTimeoutError(
          nodeKey,
          env.WORKFLOW_NODE_TIMEOUT_MS,
        );
        executionAbortController.abort(timeoutError);
        rejectNodeTimeout?.(timeoutError);
      }, env.WORKFLOW_NODE_TIMEOUT_MS);
    };

    const staleNodeRun = run.nodeRuns.find(
      (nodeRun) =>
        nodeRun.status === WorkflowNodeRunStatus.RUNNING &&
        nodeRun.startedAt &&
        Date.now() - nodeRun.startedAt.getTime() >=
          env.WORKFLOW_NODE_TIMEOUT_MS,
    );

    if (staleNodeRun) {
      activeNodeKey = staleNodeRun.nodeKey;
      nodeRunIds.set(staleNodeRun.nodeKey, staleNodeRun.id);
      nodeStartedAt.set(
        staleNodeRun.nodeKey,
        staleNodeRun.startedAt?.getTime() ?? Date.now(),
      );
    }

    try {
      if (staleNodeRun) {
        throw new WorkflowNodeTimeoutError(
          staleNodeRun.nodeKey,
          env.WORKFLOW_NODE_TIMEOUT_MS,
        );
      }

      const executionPromise = graph.execute({
        initialState: state,
        startNodeIndex,
        signal: executionAbortController.signal,
        hooks: {
          onNodeStarted: async (nodeKey) => {
            activeNodeKey = nodeKey;
            nodeStartedAt.set(nodeKey, Date.now());
            state = {
              ...state,
              currentNodeKey: nodeKey,
            };
            startNodeTimeout(nodeKey);
            assertNotTimedOut();

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
            assertNotTimedOut();

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
            assertNotTimedOut();
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
            assertNotTimedOut();
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
              output: getPersistedNodeOutput({
                graph,
                nodeKey,
                state: updatedState,
              }),
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
            clearNodeTimeout();
            assertNotTimedOut();
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
              output: getPersistedNodeOutput({
                graph,
                nodeKey,
                state: updatedState,
              }),
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
      const executedState = await Promise.race([
        executionPromise,
        nodeTimeoutPromise,
      ]);
      clearNodeTimeout();
      assertNotTimedOut();

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
      clearNodeTimeout();

      const nodeTimeout =
        timeoutError ??
        (error instanceof WorkflowNodeTimeoutError ? error : undefined);

      const cancellationRequested =
        (!nodeTimeout && executionAbortController.signal.aborted) ||
        (await this.repository.isCancellationRequested(runId));

      if (cancellationRequested) {
        const cancellationReason =
          executionAbortController.signal.reason instanceof Error
            ? executionAbortController.signal.reason.message
            : error instanceof Error
              ? error.message
              : "用户已请求取消";
        await this.repository.markRunCancelled({
          runId,
          reason: cancellationReason,
        });
        await this.publishLatestEvent(
          runId,
          state.progressPercent,
          activeNodeKey ?? state.currentNodeKey,
        );
        return;
      }

      if (nodeTimeout) {
        const failedNodeKey =
          nodeTimeout.nodeKey ??
          activeNodeKey ??
          (typeof state.currentNodeKey === "string"
            ? state.currentNodeKey
            : undefined);
        const timeoutMessage = nodeTimeout.message;
        state = {
          ...state,
          currentNodeKey: failedNodeKey,
          errors: [...(state.errors ?? []), timeoutMessage],
        };
        const nodeRunId = failedNodeKey
          ? (nodeRunIds.get(failedNodeKey) ??
            existingNodeRunIds.get(failedNodeKey))
          : undefined;

        if (failedNodeKey && nodeRunId) {
          await this.repository.markNodeFailed({
            runId,
            nodeRunId,
            nodeKey: failedNodeKey,
            errorCode: WORKFLOW_ERROR_CODES.WORKFLOW_NODE_TIMEOUT,
            errorMessage: timeoutMessage,
            durationMs:
              Date.now() - (nodeStartedAt.get(failedNodeKey) ?? Date.now()),
          });
        }

        await this.runtimeStore.saveCheckpoint(runId, state);
        await this.repository.markRunPaused({
          runId,
          currentNodeKey: failedNodeKey,
          progressPercent: state.progressPercent,
          reason: "node_timeout",
          eventPayload: {
            nodeKey: failedNodeKey,
            timeoutMs: nodeTimeout.timeoutMs,
            errorCode: WORKFLOW_ERROR_CODES.WORKFLOW_NODE_TIMEOUT,
          },
        });
        await this.agentConversationRepository?.markAssistantFailedByRun(
          runId,
          "Pi agent 节点执行超时，已暂停等待用户指示",
        );
        await this.publishLatestEvent(
          runId,
          state.progressPercent,
          failedNodeKey,
        );
        return;
      }

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

        const waitingForInput = isRecord(
          (pausedState as Record<string, unknown>).waitingForInput,
        )
          ? ((pausedState as Record<string, unknown>).waitingForInput as Record<
              string,
              unknown
            >)
          : undefined;
        const question =
          typeof waitingForInput?.question === "string"
            ? waitingForInput.question
            : undefined;
        const options = Array.isArray(waitingForInput?.options)
          ? waitingForInput.options
          : undefined;
        const waitingNodeRunId = pausedNodeKey
          ? nodeRunIds.get(pausedNodeKey) ?? existingNodeRunIds.get(pausedNodeKey)
          : undefined;

        if (
          executionAbortController.signal.aborted ||
          (await this.repository.isCancellationRequested(runId))
        ) {
          await this.repository.markRunCancelled({
            runId,
            reason: "用户已请求取消",
          });
          await this.publishLatestEvent(
            runId,
            pausedState.progressPercent,
            pausedNodeKey,
          );
          return;
        }

        if (pausedNodeKey && waitingNodeRunId && question) {
          await this.repository.markNodeWaitingForInput({
            runId,
            nodeRunId: waitingNodeRunId,
            nodeKey: pausedNodeKey,
            question,
            options,
          });
        }

        await this.runtimeStore.saveCheckpoint(runId, pausedState);
        await this.repository.markRunPaused({
          runId,
          currentNodeKey: pausedNodeKey,
          progressPercent: pausedState.progressPercent,
          reason: error.reason,
          eventPayload: {
            ...(pausedNodeKey
              ? getPausedNodeEventPayload({
                  graph,
                  nodeKey: pausedNodeKey,
                  state: pausedState,
                })
              : {}),
            ...(question ? { question } : {}),
            ...(options ? { options } : {}),
          },
        });
        if (question) {
          await this.agentConversationRepository?.markAssistantWaitingByRun(
            runId,
            {
              question,
              ...(options
                ? {
                    options: options as Array<{
                      label: string;
                      value: string;
                    }>,
                  }
                : {}),
            },
          );
        }
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
    } finally {
      await closeCancellation();
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
