import {
  WorkflowEventType,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WorkflowCommandService } from "~/modules/research/server/application/workflow/command-service";
import { WorkflowExecutionService } from "~/modules/research/server/application/workflow/execution-service";
import { WorkflowPauseError } from "~/modules/research/server/domain/workflow/errors";
import {
  buildFlow,
  makeEdge,
  makeNode,
  makeNodeResult,
  makeStage,
  type NodeResult,
  type NodeResultStatus,
} from "~/modules/research/server/domain/workflow/flow-spec";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  type WorkflowGraphState,
} from "~/modules/research/server/domain/workflow/types";
import type { PrismaWorkflowRunRepository } from "~/modules/research/server/infrastructure/workflow/prisma/workflow-run-repository";
import { CompanyResearchContractLangGraph } from "~/modules/research/server/workflows/langgraph/company-research-graph";
import type { WorkflowGraphRunner } from "~/modules/research/server/workflows/langgraph/workflow-graph";
import type { RedisWorkflowRuntimeStore } from "~/platform/workflow-runtime/redis/redis-workflow-runtime-store";

type RecoverableState = WorkflowGraphState & {
  archiveArtifacts: {
    insightIds: string[];
    versionIds: string[];
    emptyResultArchived: boolean;
  };
  scheduledReminderIds: string[];
};

type ReviewPauseState = WorkflowGraphState & {
  reviewApproved: boolean;
  archived: boolean;
};

const anyRecord = z.record(z.string(), z.unknown());

function buildTestFlow(params: {
  templateCode: string;
  templateVersion?: number;
  nodeKeys: string[];
  pauseNodes?: string[];
}) {
  const pauseNodes = new Set(params.pauseNodes ?? []);

  return buildFlow({
    templateCode: params.templateCode,
    templateVersion: params.templateVersion,
    name: params.templateCode,
    stages: [
      makeStage({ key: "scope", name: "Scope" }),
      makeStage({ key: "run", name: "Run" }),
    ],
    nodes: params.nodeKeys.map((nodeKey, index) =>
      makeNode({
        key: nodeKey,
        kind: pauseNodes.has(nodeKey) ? "gate" : "agent",
        name: nodeKey,
        goal: nodeKey,
        tools: [],
        in: anyRecord,
        out: anyRecord,
        routes: pauseNodes.has(nodeKey) ? ["ok", "pause"] : ["ok"],
        view: {
          stage: index === 0 ? "scope" : "run",
          show: true,
        },
      }),
    ),
    edges: params.nodeKeys.slice(0, -1).map((nodeKey, index) =>
      makeEdge({
        from: nodeKey,
        to: params.nodeKeys[index + 1] ?? nodeKey,
        when: "ok",
      }),
    ),
  });
}

class RecoverableGraph implements WorkflowGraphRunner {
  readonly templateCode = "recoverable_graph";
  readonly templateVersion = 1;
  readonly spec = buildTestFlow({
    templateCode: this.templateCode,
    templateVersion: this.templateVersion,
    nodeKeys: ["archive_insights", "schedule_review_reminders"],
  });
  readonly startedNodes: string[] = [];

  getNodeOrder() {
    return ["archive_insights", "schedule_review_reminders"];
  }

  buildInitialState(): RecoverableState {
    return {
      runId: "run_1",
      userId: "user_1",
      query: "recoverable",
      progressPercent: 0,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      errors: [],
      archiveArtifacts: {
        insightIds: [],
        versionIds: [],
        emptyResultArchived: false,
      },
      scheduledReminderIds: [],
    };
  }

  getNodeOutput(_nodeKey: string, state: WorkflowGraphState) {
    const recoverableState = state as RecoverableState;

    return {
      archiveArtifacts: recoverableState.archiveArtifacts,
      scheduledReminderIds: recoverableState.scheduledReminderIds,
    };
  }

  getNodeEventPayload() {
    return {};
  }

  buildNodeResult(
    nodeKey: string,
    state: WorkflowGraphState,
    params?: {
      status?: NodeResultStatus;
      route?: { key: string; reason: string };
    },
  ) {
    const status = params?.status ?? "ok";
    return makeNodeResult({
      status,
      data: this.getNodeOutput(nodeKey, state),
      route:
        params?.route ??
        (status === "skip"
          ? { key: "skip", reason: `${nodeKey}_skipped` }
          : { key: "ok", reason: `${nodeKey}_done` }),
      stats: this.getNodeEventPayload(),
      note: `${nodeKey}:${status}`,
    });
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: string,
    result: NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState) {
    const recoverableState = state as RecoverableState;

    return {
      archiveArtifacts: recoverableState.archiveArtifacts,
      scheduledReminderIds: recoverableState.scheduledReminderIds,
    };
  }

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: {
      onNodeStarted?: (nodeKey: string) => Promise<void> | void;
      onNodeSucceeded?: (
        nodeKey: string,
        updatedState: WorkflowGraphState,
      ) => Promise<void> | void;
    };
  }): Promise<WorkflowGraphState> {
    let state = params.initialState as RecoverableState;
    const nodeOrder = this.getNodeOrder();

    for (const nodeKey of nodeOrder.slice(params.startNodeIndex ?? 0)) {
      this.startedNodes.push(nodeKey);
      await params.hooks?.onNodeStarted?.(nodeKey);

      if (nodeKey === "schedule_review_reminders") {
        state = {
          ...state,
          scheduledReminderIds: ["rem_1"],
          currentNodeKey: nodeKey,
          lastCompletedNodeKey: nodeKey,
          progressPercent: 100,
        };
      }

      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }
}

class ReviewPauseGraph implements WorkflowGraphRunner {
  readonly templateCode = SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE;
  readonly templateVersion = 1;
  readonly spec = buildTestFlow({
    templateCode: this.templateCode,
    templateVersion: this.templateVersion,
    nodeKeys: ["validate_insights", "review_gate", "archive_insights"],
    pauseNodes: ["review_gate"],
  });

  getNodeOrder() {
    return ["validate_insights", "review_gate", "archive_insights"];
  }

  buildInitialState(): ReviewPauseState {
    return {
      runId: "run_1",
      userId: "user_1",
      query: "screening insight",
      progressPercent: 0,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      errors: [],
      reviewApproved: false,
      archived: false,
    };
  }

  getNodeOutput(nodeKey: string, state: WorkflowGraphState) {
    const reviewState = state as ReviewPauseState;

    if (nodeKey === "review_gate") {
      return {
        reviewApproved: reviewState.reviewApproved,
      };
    }

    if (nodeKey === "archive_insights") {
      return {
        archived: reviewState.archived,
      };
    }

    return {};
  }

  getNodeEventPayload(nodeKey: string, state: WorkflowGraphState) {
    if (nodeKey !== "review_gate") {
      return {};
    }

    const reviewState = state as ReviewPauseState;

    return {
      needsReviewCount: 1,
      reviewApproved: reviewState.reviewApproved,
    };
  }

  buildNodeResult(
    nodeKey: string,
    state: WorkflowGraphState,
    params?: {
      status?: NodeResultStatus;
      route?: { key: string; reason: string };
      note?: string;
    },
  ) {
    const status = params?.status ?? "ok";
    return makeNodeResult({
      status,
      data: this.getNodeOutput(nodeKey, state),
      route:
        params?.route ??
        (status === "pause"
          ? { key: "pause", reason: "review_required" }
          : { key: "ok", reason: `${nodeKey}_done` }),
      stats: this.getNodeEventPayload(nodeKey, state),
      note: params?.note ?? `${nodeKey}:${status}`,
    });
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: string,
    result: NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState) {
    return {
      archived: (state as ReviewPauseState).archived,
    };
  }

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: {
      onNodeStarted?: (nodeKey: string) => Promise<void> | void;
      onNodeProgress?: (
        nodeKey: string,
        payload: Record<string, unknown>,
      ) => Promise<void> | void;
      onNodeSucceeded?: (
        nodeKey: string,
        updatedState: WorkflowGraphState,
      ) => Promise<void> | void;
    };
  }): Promise<WorkflowGraphState> {
    let state = params.initialState as ReviewPauseState;

    for (const nodeKey of this.getNodeOrder().slice(
      params.startNodeIndex ?? 0,
    )) {
      await params.hooks?.onNodeStarted?.(nodeKey);
      await params.hooks?.onNodeProgress?.(nodeKey, {
        message: `processing_${nodeKey}`,
      });

      if (nodeKey === "validate_insights") {
        state = {
          ...state,
          currentNodeKey: nodeKey,
          lastCompletedNodeKey: nodeKey,
          progressPercent: 33,
        };
        await params.hooks?.onNodeSucceeded?.(nodeKey, state);
        continue;
      }

      if (nodeKey === "review_gate") {
        state = {
          ...state,
          currentNodeKey: nodeKey,
          progressPercent: 67,
        };

        if (!state.reviewApproved) {
          throw new WorkflowPauseError(
            "insights_need_review",
            "review_required",
            state,
          );
        }

        state = {
          ...state,
          reviewApproved: true,
          lastCompletedNodeKey: nodeKey,
        };
        await params.hooks?.onNodeSucceeded?.(nodeKey, state);
        continue;
      }

      state = {
        ...state,
        archived: true,
        currentNodeKey: nodeKey,
        lastCompletedNodeKey: nodeKey,
        progressPercent: 100,
      };
      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }
}

class ClarificationPauseGraph implements WorkflowGraphRunner {
  readonly templateCode = QUICK_RESEARCH_TEMPLATE_CODE;
  readonly templateVersion = 2;
  readonly spec = buildTestFlow({
    templateCode: this.templateCode,
    templateVersion: this.templateVersion,
    nodeKeys: ["agent0_clarify_scope", "agent1_write_research_brief"],
    pauseNodes: ["agent0_clarify_scope"],
  });

  getNodeOrder() {
    return ["agent0_clarify_scope", "agent1_write_research_brief"];
  }

  buildInitialState(): WorkflowGraphState {
    return {
      runId: "run_1",
      userId: "user_1",
      query: "AI infra",
      progressPercent: 0,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      errors: [],
    };
  }

  getNodeOutput() {
    return {};
  }

  getNodeEventPayload(nodeKey: string, state: WorkflowGraphState) {
    if (nodeKey !== "agent0_clarify_scope") {
      return {};
    }

    return {
      clarificationRequired: true,
      question:
        (
          state as WorkflowGraphState & {
            clarificationRequest?: { question?: string };
          }
        ).clarificationRequest?.question ?? "Need more detail",
      missingScopeFields: ["query"],
      suggestedInputPatch: {
        researchPreferences: {
          researchGoal: "Narrow the scope",
        },
      },
    };
  }

  buildNodeResult(
    nodeKey: string,
    state: WorkflowGraphState,
    params?: {
      status?: NodeResultStatus;
      route?: { key: string; reason: string };
      note?: string;
    },
  ) {
    const status = params?.status ?? "ok";
    return makeNodeResult({
      status,
      data: this.getNodeOutput(),
      route:
        params?.route ??
        (status === "pause"
          ? { key: "pause", reason: "clarification_required" }
          : { key: "ok", reason: `${nodeKey}_done` }),
      stats: this.getNodeEventPayload(nodeKey, state),
      note: params?.note ?? `${nodeKey}:${status}`,
    });
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: string,
    result: NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult() {
    return {};
  }

  async execute(_params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
  }): Promise<WorkflowGraphState> {
    throw new WorkflowPauseError("Need more detail", "clarification_required", {
      currentNodeKey: "agent0_clarify_scope",
      clarificationRequest: {
        needClarification: true,
        question: "Need more detail",
        verification: "",
        missingScopeFields: ["query"],
        suggestedInputPatch: {
          researchPreferences: {
            researchGoal: "Narrow the scope",
          },
        },
      },
    });
  }
}

class FailingActiveNodeGraph implements WorkflowGraphRunner {
  readonly templateCode = "failing_active_node_graph";
  readonly templateVersion = 1;
  readonly spec = buildTestFlow({
    templateCode: this.templateCode,
    templateVersion: this.templateVersion,
    nodeKeys: ["first_node", "second_node"],
  });

  getNodeOrder() {
    return ["first_node", "second_node"];
  }

  buildInitialState(): WorkflowGraphState {
    return {
      runId: "run_1",
      userId: "user_1",
      query: "failing graph",
      progressPercent: 0,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      errors: [],
    };
  }

  getNodeOutput(nodeKey: string) {
    if (nodeKey === "first_node") {
      return {
        firstNodeComplete: true,
      };
    }

    return {};
  }

  getNodeEventPayload() {
    return {};
  }

  buildNodeResult(
    nodeKey: string,
    _state: WorkflowGraphState,
    params?: {
      status?: NodeResultStatus;
      route?: { key: string; reason: string };
    },
  ) {
    const status = params?.status ?? "ok";
    return makeNodeResult({
      status,
      data: this.getNodeOutput(nodeKey),
      route:
        params?.route ??
        (status === "skip"
          ? { key: "skip", reason: `${nodeKey}_skipped` }
          : { key: "ok", reason: `${nodeKey}_done` }),
      stats: this.getNodeEventPayload(),
      note: `${nodeKey}:${status}`,
    });
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: string,
    result: NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult() {
    return {};
  }

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: {
      onNodeStarted?: (nodeKey: string) => Promise<void> | void;
      onNodeProgress?: (
        nodeKey: string,
        payload: Record<string, unknown>,
      ) => Promise<void> | void;
      onNodeSucceeded?: (
        nodeKey: string,
        updatedState: WorkflowGraphState,
      ) => Promise<void> | void;
    };
  }): Promise<WorkflowGraphState> {
    let state = params.initialState;

    await params.hooks?.onNodeStarted?.("first_node");
    await params.hooks?.onNodeProgress?.("first_node", {
      message: "processing_first_node",
    });

    state = {
      ...state,
      currentNodeKey: "first_node",
      lastCompletedNodeKey: "first_node",
      progressPercent: 50,
    };
    await params.hooks?.onNodeSucceeded?.("first_node", state);

    await params.hooks?.onNodeStarted?.("second_node");
    await params.hooks?.onNodeProgress?.("second_node", {
      message: "processing_second_node",
    });

    throw new Error("second_node_failed");
  }
}

type MutableRunState = {
  id: string;
  userId: string;
  query: string;
  input: Record<string, unknown>;
  progressPercent: number;
  currentNodeKey: string | null;
  status: WorkflowRunStatus;
  result: Record<string, unknown> | null;
  template: {
    code: string;
    version?: number;
  };
  nodeRuns: Array<{
    id: string;
    nodeKey: string;
    agentName: string;
    attempt: number;
    status: WorkflowNodeRunStatus;
    output: unknown;
    input?: Record<string, unknown>;
  }>;
};

function createRepositoryHarness(params: {
  graph: WorkflowGraphRunner;
  status: WorkflowRunStatus;
  progressPercent?: number;
  currentNodeKey?: string | null;
  query?: string;
  nodeRuns?: Array<{
    id?: string;
    nodeKey: string;
    status: WorkflowNodeRunStatus;
    output?: unknown;
  }>;
}) {
  const run: MutableRunState = {
    id: "run_1",
    userId: "user_1",
    query: params.query ?? "workflow",
    input: {},
    progressPercent: params.progressPercent ?? 0,
    currentNodeKey: params.currentNodeKey ?? null,
    status: params.status,
    result: null,
    template: {
      code: params.graph.templateCode,
      version: params.graph.templateVersion,
    },
    nodeRuns:
      params.nodeRuns?.map((nodeRun) => ({
        id: nodeRun.id ?? `node_${nodeRun.nodeKey}`,
        nodeKey: nodeRun.nodeKey,
        agentName: nodeRun.nodeKey,
        attempt: 1,
        status: nodeRun.status,
        output: nodeRun.output ?? null,
      })) ??
      params.graph.getNodeOrder().map((nodeKey) => ({
        id: `node_${nodeKey}`,
        nodeKey,
        agentName: nodeKey,
        attempt: 1,
        status: WorkflowNodeRunStatus.PENDING,
        output: null,
      })),
  };

  let sequence = 0;
  let latestEvent: {
    sequence: number;
    eventType: WorkflowEventType;
    payload: Record<string, unknown>;
    occurredAt: Date;
  } | null = null;

  const recordEvent = (
    eventType: WorkflowEventType,
    payload: Record<string, unknown>,
  ) => {
    sequence += 1;
    latestEvent = {
      sequence,
      eventType,
      payload,
      occurredAt: new Date(sequence * 1000),
    };
  };

  const findNodeRun = (nodeKey: string) =>
    run.nodeRuns.find((nodeRun) => nodeRun.nodeKey === nodeKey);

  const repository = {
    listRunningRuns: vi.fn(async () =>
      run.status === WorkflowRunStatus.RUNNING
        ? [
            {
              id: run.id,
              progressPercent: run.progressPercent,
              currentNodeKey: run.currentNodeKey,
              template: run.template,
            },
          ]
        : [],
    ),
    claimNextPendingRun: vi.fn(async (workerId: string) => {
      if (run.status !== WorkflowRunStatus.PENDING) {
        return null;
      }

      run.status = WorkflowRunStatus.RUNNING;
      recordEvent(WorkflowEventType.RUN_STARTED, { workerId });

      return {
        id: run.id,
        progressPercent: run.progressPercent,
        currentNodeKey: run.currentNodeKey,
        template: run.template,
      };
    }),
    getRunById: vi.fn(async () => ({
      ...run,
      template: run.template,
      nodeRuns: run.nodeRuns.map((nodeRun) => ({ ...nodeRun })),
    })),
    isCancellationRequested: vi.fn(async () => false),
    markNodeStarted: vi.fn(
      async (params: {
        nodeKey: string;
        agentName: string;
        attempt: number;
        input: Record<string, unknown>;
      }) => {
        let nodeRun = findNodeRun(params.nodeKey);

        if (!nodeRun) {
          nodeRun = {
            id: `node_${params.nodeKey}`,
            nodeKey: params.nodeKey,
            agentName: params.agentName,
            attempt: params.attempt,
            status: WorkflowNodeRunStatus.PENDING,
            output: null,
          };
          run.nodeRuns.push(nodeRun);
        }

        nodeRun.agentName = params.agentName;
        nodeRun.attempt = params.attempt;
        nodeRun.status = WorkflowNodeRunStatus.RUNNING;
        nodeRun.input = params.input;
        recordEvent(WorkflowEventType.NODE_STARTED, {
          nodeKey: params.nodeKey,
        });

        return {
          id: nodeRun.id,
        };
      },
    ),
    updateRunProgress: vi.fn(
      async (params: { currentNodeKey?: string; progressPercent: number }) => {
        run.currentNodeKey = params.currentNodeKey ?? null;
        run.progressPercent = params.progressPercent;
      },
    ),
    addNodeProgressEvent: vi.fn(
      async (params: { nodeKey: string; payload: Record<string, unknown> }) => {
        recordEvent(WorkflowEventType.NODE_PROGRESS, {
          nodeKey: params.nodeKey,
          ...params.payload,
        });
      },
    ),
    markNodeSucceeded: vi.fn(
      async (params: {
        nodeKey: string;
        output: Record<string, unknown>;
        durationMs: number;
        eventPayload?: Record<string, unknown>;
      }) => {
        const nodeRun = findNodeRun(params.nodeKey);

        if (nodeRun) {
          nodeRun.status = WorkflowNodeRunStatus.SUCCEEDED;
          nodeRun.output = params.output;
        }

        recordEvent(WorkflowEventType.NODE_SUCCEEDED, {
          nodeKey: params.nodeKey,
          durationMs: params.durationMs,
          ...(params.eventPayload ?? {}),
        });
      },
    ),
    markNodeSkipped: vi.fn(
      async (params: {
        nodeKey: string;
        output: Record<string, unknown>;
        durationMs: number;
        reason: string;
        eventPayload?: Record<string, unknown>;
      }) => {
        const nodeRun = findNodeRun(params.nodeKey);

        if (nodeRun) {
          nodeRun.status = WorkflowNodeRunStatus.SKIPPED;
          nodeRun.output = params.output;
        }

        recordEvent(WorkflowEventType.NODE_SUCCEEDED, {
          nodeKey: params.nodeKey,
          durationMs: params.durationMs,
          skipped: true,
          reason: params.reason,
          ...(params.eventPayload ?? {}),
        });
      },
    ),
    markNodeFailed: vi.fn(
      async (params: {
        nodeKey: string;
        errorCode: string;
        errorMessage: string;
      }) => {
        const nodeRun = findNodeRun(params.nodeKey);

        if (nodeRun) {
          nodeRun.status = WorkflowNodeRunStatus.FAILED;
        }

        recordEvent(WorkflowEventType.NODE_FAILED, {
          nodeKey: params.nodeKey,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        });
      },
    ),
    markRunSucceeded: vi.fn(
      async (params: { result: Record<string, unknown> }) => {
        run.status = WorkflowRunStatus.SUCCEEDED;
        run.progressPercent = 100;
        run.result = params.result;
        recordEvent(WorkflowEventType.RUN_SUCCEEDED, {
          completedAt: new Date().toISOString(),
        });
      },
    ),
    markRunFailed: vi.fn(
      async (params: { errorCode: string; errorMessage: string }) => {
        run.status = WorkflowRunStatus.FAILED;
        recordEvent(WorkflowEventType.RUN_FAILED, {
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        });
      },
    ),
    markRunCancelled: vi.fn(async (params: { reason: string }) => {
      run.status = WorkflowRunStatus.CANCELLED;
      recordEvent(WorkflowEventType.RUN_CANCELLED, {
        reason: params.reason,
      });
    }),
    markRunPaused: vi.fn(
      async (params: {
        currentNodeKey?: string;
        progressPercent: number;
        reason: string;
        eventPayload?: Record<string, unknown>;
      }) => {
        run.status = WorkflowRunStatus.PAUSED;
        run.currentNodeKey = params.currentNodeKey ?? null;
        run.progressPercent = params.progressPercent;
        recordEvent(WorkflowEventType.RUN_PAUSED, {
          reason: params.reason,
          nodeKey: params.currentNodeKey,
          ...(params.eventPayload ?? {}),
        });
      },
    ),
    markRunResumed: vi.fn(
      async (params: {
        currentNodeKey?: string;
        progressPercent: number;
        reason?: string;
        eventPayload?: Record<string, unknown>;
      }) => {
        run.status = WorkflowRunStatus.RUNNING;
        run.currentNodeKey = params.currentNodeKey ?? null;
        run.progressPercent = params.progressPercent;
        recordEvent(WorkflowEventType.RUN_RESUMED, {
          reason: params.reason ?? "user_resumed",
          nodeKey: params.currentNodeKey,
          ...(params.eventPayload ?? {}),
        });
      },
    ),
    getLatestEvent: vi.fn(async () => latestEvent),
    findNodeRun: vi.fn(async (_runId: string, nodeKey: string) =>
      findNodeRun(nodeKey),
    ),
  } as unknown as PrismaWorkflowRunRepository;

  return { repository, run };
}

function createRuntimeStoreHarness(checkpoint: WorkflowGraphState | null) {
  let currentCheckpoint = checkpoint;
  const publishedEvents: Array<{
    type: string;
    payload: Record<string, unknown>;
  }> = [];

  const runtimeStore = {
    loadCheckpoint: vi.fn(async () => currentCheckpoint),
    saveCheckpoint: vi.fn(async (_runId: string, state: WorkflowGraphState) => {
      currentCheckpoint = state;
    }),
    clearCheckpoint: vi.fn(async () => {
      currentCheckpoint = null;
    }),
    publishEvent: vi.fn(
      async (event: { type: string; payload: Record<string, unknown> }) => {
        publishedEvents.push(event);
      },
    ),
  } as unknown as RedisWorkflowRuntimeStore;

  return {
    runtimeStore,
    getCheckpoint: () => currentCheckpoint,
    publishedEvents,
  };
}

describe("WorkflowExecutionService", () => {
  it("??????????????????", async () => {
    const graph = new RecoverableGraph();
    const repository = {
      listRunningRuns: vi.fn().mockResolvedValue([
        {
          id: "run_1",
          progressPercent: 50,
          currentNodeKey: "archive_insights",
          template: {
            code: graph.templateCode,
            version: graph.templateVersion,
          },
        },
      ]),
      getRunById: vi.fn().mockResolvedValue({
        id: "run_1",
        userId: "user_1",
        query: "recoverable",
        input: {},
        progressPercent: 50,
        currentNodeKey: "archive_insights",
        template: { code: graph.templateCode, version: graph.templateVersion },
        nodeRuns: [
          {
            id: "node_archive",
            nodeKey: "archive_insights",
            status: WorkflowNodeRunStatus.SUCCEEDED,
            output: {
              archiveArtifacts: {
                insightIds: ["insight_1"],
                versionIds: ["version_1"],
                emptyResultArchived: false,
              },
            },
          },
          {
            id: "node_reminder",
            nodeKey: "schedule_review_reminders",
            status: WorkflowNodeRunStatus.PENDING,
            output: null,
          },
        ],
      }),
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      markNodeStarted: vi.fn().mockResolvedValue({ id: "node_reminder" }),
      updateRunProgress: vi.fn().mockResolvedValue(undefined),
      addNodeProgressEvent: vi.fn().mockResolvedValue(undefined),
      markNodeSucceeded: vi.fn().mockResolvedValue(undefined),
      markNodeSkipped: vi.fn().mockResolvedValue(undefined),
      markRunSucceeded: vi.fn().mockResolvedValue(undefined),
      markRunCancelled: vi.fn().mockResolvedValue(undefined),
      markNodeFailed: vi.fn().mockResolvedValue(undefined),
      markRunFailed: vi.fn().mockResolvedValue(undefined),
      getLatestEvent: vi.fn().mockResolvedValue(null),
      findNodeRun: vi.fn().mockResolvedValue({ id: "node_reminder" }),
    } as unknown as PrismaWorkflowRunRepository;

    const runtimeStore = {
      loadCheckpoint: vi.fn().mockResolvedValue(null),
      saveCheckpoint: vi.fn().mockResolvedValue(undefined),
      clearCheckpoint: vi.fn().mockResolvedValue(undefined),
      publishEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisWorkflowRuntimeStore;

    const service = new WorkflowExecutionService({
      repository,
      runtimeStore,
      graphs: [graph],
    });

    const recovered = await service.executeRecoverableRunningRun("worker_1");

    expect(recovered).toBe(true);
    expect(graph.startedNodes).toEqual(["schedule_review_reminders"]);
    expect(repository.markNodeStarted).toHaveBeenCalledTimes(1);
    expect(repository.markRunSucceeded).toHaveBeenCalledTimes(1);
    expect(runtimeStore.saveCheckpoint).toHaveBeenCalled();
  });

  it("marks the run as paused when review approval is required", async () => {
    const graph = new ReviewPauseGraph();
    const { repository, run } = createRepositoryHarness({
      graph,
      status: WorkflowRunStatus.PENDING,
      nodeRuns: graph.getNodeOrder().map((nodeKey) => ({
        nodeKey,
        status: WorkflowNodeRunStatus.PENDING,
      })),
    });
    const runtimeStoreHarness = createRuntimeStoreHarness(null);

    const service = new WorkflowExecutionService({
      repository,
      runtimeStore: runtimeStoreHarness.runtimeStore,
      graphs: [graph],
    });

    const picked = await service.executeNextPendingRun("worker_1");

    expect(picked).toBe(true);
    expect(run.status).toBe(WorkflowRunStatus.PAUSED);
    expect(repository.markRunPaused).toHaveBeenCalledTimes(1);
    expect(repository.markRunFailed).not.toHaveBeenCalled();
    expect(repository.markNodeFailed).not.toHaveBeenCalled();
    expect(runtimeStoreHarness.getCheckpoint()).toMatchObject({
      currentNodeKey: "review_gate",
      lastCompletedNodeKey: "validate_insights",
      reviewApproved: false,
    });
    expect(runtimeStoreHarness.publishedEvents.at(-1)?.type).toBe("RUN_PAUSED");
  });

  it("preserves clarification payload when a research run pauses for missing scope", async () => {
    const graph = new ClarificationPauseGraph();
    const { repository, run } = createRepositoryHarness({
      graph,
      status: WorkflowRunStatus.PENDING,
      nodeRuns: graph.getNodeOrder().map((nodeKey) => ({
        nodeKey,
        status: WorkflowNodeRunStatus.PENDING,
      })),
    });
    const runtimeStoreHarness = createRuntimeStoreHarness(null);

    const service = new WorkflowExecutionService({
      repository,
      runtimeStore: runtimeStoreHarness.runtimeStore,
      graphs: [graph],
    });

    const picked = await service.executeNextPendingRun("worker_1");

    expect(picked).toBe(true);
    expect(run.status).toBe(WorkflowRunStatus.PAUSED);
    expect(repository.markRunPaused).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "clarification_required",
        currentNodeKey: "agent0_clarify_scope",
        eventPayload: expect.objectContaining({
          question: "Need more detail",
          clarificationRequired: true,
        }),
      }),
    );
    expect(runtimeStoreHarness.getCheckpoint()).toMatchObject({
      currentNodeKey: "agent0_clarify_scope",
      clarificationRequest: {
        question: "Need more detail",
      },
    });
  });

  it("preserves clarification payload for real langgraph-based company research pauses", async () => {
    const graph = new CompanyResearchContractLangGraph({
      clarifyScope: vi.fn(async () => ({
        needClarification: true,
        question: "Need company focus",
        verification: "Clarify the target business line",
        missingScopeFields: ["keyQuestion"],
        suggestedInputPatch: {
          keyQuestion: "Which business line has the strongest moat?",
        },
      })),
    } as never);
    const { repository, run } = createRepositoryHarness({
      graph,
      status: WorkflowRunStatus.PENDING,
      query: "Example Corp",
      nodeRuns: graph.getNodeOrder().map((nodeKey) => ({
        nodeKey,
        status: WorkflowNodeRunStatus.PENDING,
      })),
    });
    run.input = {
      companyName: "Example Corp",
    };
    const runtimeStoreHarness = createRuntimeStoreHarness(null);
    const service = new WorkflowExecutionService({
      repository,
      runtimeStore: runtimeStoreHarness.runtimeStore,
      graphs: [graph],
    });

    const picked = await service.executeNextPendingRun("worker_1");

    expect(picked).toBe(true);
    expect(run.status).toBe(WorkflowRunStatus.PAUSED);
    expect(run.template.code).toBe(COMPANY_RESEARCH_TEMPLATE_CODE);
    expect(repository.markRunPaused).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "clarification_required",
        currentNodeKey: "agent0_clarify_scope",
        eventPayload: expect.objectContaining({
          clarificationRequired: true,
          question: "Need company focus",
          verification: "Clarify the target business line",
          missingScopeFields: ["keyQuestion"],
        }),
      }),
    );
    expect(runtimeStoreHarness.getCheckpoint()).toMatchObject({
      currentNodeKey: "agent0_clarify_scope",
      clarificationRequest: {
        question: "Need company focus",
        verification: "Clarify the target business line",
      },
    });
  });

  it("marks the actually running node as failed when the next node crashes", async () => {
    const graph = new FailingActiveNodeGraph();
    const { repository, run } = createRepositoryHarness({
      graph,
      status: WorkflowRunStatus.PENDING,
      nodeRuns: graph.getNodeOrder().map((nodeKey) => ({
        nodeKey,
        status: WorkflowNodeRunStatus.PENDING,
      })),
    });
    const runtimeStoreHarness = createRuntimeStoreHarness(null);

    const service = new WorkflowExecutionService({
      repository,
      runtimeStore: runtimeStoreHarness.runtimeStore,
      graphs: [graph],
    });

    const picked = await service.executeNextPendingRun("worker_1");

    expect(picked).toBe(true);
    expect(run.status).toBe(WorkflowRunStatus.FAILED);
    expect(run.currentNodeKey).toBe("second_node");
    expect(repository.markNodeFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeKey: "second_node",
        errorMessage: "second_node_failed",
      }),
    );
    expect(run.nodeRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeKey: "first_node",
          status: WorkflowNodeRunStatus.SUCCEEDED,
        }),
        expect.objectContaining({
          nodeKey: "second_node",
          status: WorkflowNodeRunStatus.FAILED,
        }),
      ]),
    );
    expect(runtimeStoreHarness.publishedEvents.at(-1)?.type).toBe("RUN_FAILED");
  });

  it("approves a paused screening run and lets the worker finish it", async () => {
    const graph = new ReviewPauseGraph();
    const { repository, run } = createRepositoryHarness({
      graph,
      status: WorkflowRunStatus.PAUSED,
      progressPercent: 67,
      currentNodeKey: "review_gate",
      nodeRuns: [
        {
          nodeKey: "validate_insights",
          status: WorkflowNodeRunStatus.SUCCEEDED,
          output: {},
        },
        {
          nodeKey: "review_gate",
          status: WorkflowNodeRunStatus.RUNNING,
        },
        {
          nodeKey: "archive_insights",
          status: WorkflowNodeRunStatus.PENDING,
        },
      ],
    });
    const runtimeStoreHarness = createRuntimeStoreHarness({
      runId: "run_1",
      userId: "user_1",
      query: "screening insight",
      progressPercent: 67,
      currentNodeKey: "review_gate",
      lastCompletedNodeKey: "validate_insights",
      errors: [],
      reviewApproved: false,
      archived: false,
    } as ReviewPauseState);

    const commandService = new WorkflowCommandService(
      repository,
      runtimeStoreHarness.runtimeStore,
    );

    await commandService.approveScreeningInsights({
      userId: "user_1",
      runId: "run_1",
    });

    expect(run.status).toBe(WorkflowRunStatus.RUNNING);
    expect(runtimeStoreHarness.getCheckpoint()).toMatchObject({
      reviewApproved: true,
    });
    expect(repository.markRunResumed).toHaveBeenCalledTimes(1);
    expect(runtimeStoreHarness.publishedEvents.length).toBeGreaterThan(0);

    const executionService = new WorkflowExecutionService({
      repository,
      runtimeStore: runtimeStoreHarness.runtimeStore,
      graphs: [graph],
    });

    const recovered =
      await executionService.executeRecoverableRunningRun("worker_1");

    expect(recovered).toBe(true);
    expect(run.status).toBe(WorkflowRunStatus.SUCCEEDED);
    expect(repository.markRunSucceeded).toHaveBeenCalledTimes(1);
    expect(runtimeStoreHarness.getCheckpoint()).toBeNull();
  });
});
