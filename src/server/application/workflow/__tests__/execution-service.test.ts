import { describe, expect, it, vi } from "vitest";
import { WorkflowNodeRunStatus } from "~/generated/prisma";
import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";
import type { WorkflowGraphState } from "~/server/domain/workflow/types";
import type { WorkflowGraphRunner } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import type { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

type RecoverableState = WorkflowGraphState & {
  archiveArtifacts: {
    insightIds: string[];
    versionIds: string[];
    emptyResultArchived: boolean;
  };
  scheduledReminderIds: string[];
};

class RecoverableGraph implements WorkflowGraphRunner {
  readonly templateCode = "recoverable_graph";
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

  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: string,
    output: Record<string, unknown>,
  ) {
    return {
      ...state,
      ...output,
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
  }) {
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

describe("WorkflowExecutionService", () => {
  it("恢复运行时会从已成功节点之后继续执行", async () => {
    const graph = new RecoverableGraph();
    const repository = {
      listRunningRuns: vi.fn().mockResolvedValue([
        {
          id: "run_1",
          progressPercent: 50,
          currentNodeKey: "archive_insights",
          template: { code: graph.templateCode },
        },
      ]),
      getRunById: vi.fn().mockResolvedValue({
        id: "run_1",
        userId: "user_1",
        query: "recoverable",
        input: {},
        progressPercent: 50,
        currentNodeKey: "archive_insights",
        template: { code: graph.templateCode },
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
});
