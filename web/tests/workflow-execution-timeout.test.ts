import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
  env: {
    WORKFLOW_NODE_TIMEOUT_MS: 25,
  },
}));

import { WorkflowExecutionService } from "~/server/application/workflow/execution-service";

describe("WorkflowExecutionService node timeout", () => {
  it("marks the node failed and pauses the run", async () => {
    const calls = {
      markNodeFailed: vi.fn(),
      markRunPaused: vi.fn(),
      markAssistantFailedByRun: vi.fn(),
    };
    const run = {
      id: "run-1",
      userId: "user-1",
      query: "测试超时",
      input: {},
      progressPercent: 0,
      currentNodeKey: null,
      nodeRuns: [
        {
          id: "node-run-1",
          nodeKey: "stuck_node",
          status: "PENDING",
          output: null,
          startedAt: null,
        },
      ],
      template: {
        code: "timeout-test",
        version: 1,
        graphConfig: {},
      },
    };
    const repository = {
      claimNextPendingRun: vi.fn(async () => run),
      getRunById: vi.fn(async () => run),
      isCancellationRequested: vi.fn(async () => false),
      markNodeStarted: vi.fn(async () => ({ id: "node-run-1" })),
      updateRunProgress: vi.fn(async () => undefined),
      addNodeProgressEvent: vi.fn(async () => undefined),
      findNodeRun: vi.fn(async () => ({ id: "node-run-1" })),
      getLatestEvent: vi.fn(async () => null),
      markNodeFailed: calls.markNodeFailed,
      markRunPaused: calls.markRunPaused,
    };
    const runtimeStore = {
      loadCheckpoint: vi.fn(async () => null),
      saveCheckpoint: vi.fn(async () => undefined),
      publishEvent: vi.fn(async () => undefined),
      clearCheckpoint: vi.fn(async () => undefined),
    };
    const graph = {
      templateCode: "timeout-test",
      templateVersion: 1,
      getNodeOrder: () => ["stuck_node"],
      buildInitialState: () => ({
        runId: run.id,
        userId: run.userId,
        query: run.query,
        progressPercent: 0,
        errors: [],
      }),
      getNodeOutput: () => ({}),
      getNodeEventPayload: () => ({}),
      mergeNodeOutput: (state: Record<string, unknown>) => state,
      getRunResult: () => ({}),
      execute: async (params: {
        hooks?: {
          onNodeStarted?: (nodeKey: string) => Promise<void> | void;
          onNodeSucceeded?: (
            nodeKey: string,
            state: Record<string, unknown>,
          ) => Promise<void> | void;
        };
        initialState: Record<string, unknown>;
      }) => {
        await params.hooks?.onNodeStarted?.("stuck_node");
        await new Promise((resolve) => setTimeout(resolve, 100));
        await params.hooks?.onNodeSucceeded?.("stuck_node", {
          ...params.initialState,
          currentNodeKey: "stuck_node",
        });
        return params.initialState;
      },
    };

    const service = new WorkflowExecutionService({
      repository: repository as never,
      runtimeStore: runtimeStore as never,
      graphs: [graph as never],
      agentConversationRepository: {
        markAssistantFailedByRun: calls.markAssistantFailedByRun,
      } as never,
    });

    await service.executeNextPendingRun("worker-1");

    expect(calls.markNodeFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        nodeKey: "stuck_node",
        errorCode: "WORKFLOW_NODE_TIMEOUT",
      }),
    );
    expect(calls.markRunPaused).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        reason: "node_timeout",
      }),
    );
    expect(calls.markAssistantFailedByRun).toHaveBeenCalledWith(
      run.id,
      expect.any(String),
    );
  });
});
