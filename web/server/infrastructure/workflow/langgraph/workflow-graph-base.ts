import type { CompiledStateGraph } from "@langchain/langgraph";
import { WorkflowPauseError } from "~/server/domain/workflow/errors";
import type {
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import type {
  WorkflowGraphBuildInitialStateParams,
  WorkflowGraphExecutionHooks,
  WorkflowGraphRunner,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph";

type TaskStreamPayload = {
  id: string;
  name: string;
  interrupts?: unknown[];
  input?: unknown;
  triggers?: string[];
  result?: Record<string, unknown>;
};

type StreamChunk = {
  mode: string;
  payload: unknown;
};

export type WorkflowGraphSkip<NodeKey extends string> = {
  nodeKey: NodeKey;
  reason: string;
  payload?: Record<string, unknown>;
};

function isTaskPayload(value: unknown): value is TaskStreamPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return typeof (value as TaskStreamPayload).name === "string";
}

function isTaskResult(payload: TaskStreamPayload) {
  return (
    typeof payload.result === "object" &&
    payload.result !== null &&
    !Array.isArray(payload.result)
  );
}

function parseStreamChunk(chunk: unknown): StreamChunk | null {
  if (!Array.isArray(chunk) || chunk.length !== 2) {
    return null;
  }

  const [mode, payload] = chunk;

  if (typeof mode !== "string") {
    return null;
  }

  return { mode, payload };
}

export abstract class BaseWorkflowLangGraph<
  State extends WorkflowGraphState,
  NodeKey extends string,
> implements WorkflowGraphRunner
{
  abstract readonly templateCode: string;

  protected readonly graph: CompiledStateGraph<unknown, unknown, string>;
  protected readonly nodeOrder: readonly NodeKey[];
  private readonly nodeIndex: Map<NodeKey, number>;
  private readonly nodeKeySet: Set<string>;

  protected constructor(params: {
    graph: CompiledStateGraph<unknown, unknown, string>;
    nodeOrder: readonly NodeKey[];
  }) {
    this.graph = params.graph;
    this.nodeOrder = params.nodeOrder;
    this.nodeIndex = new Map(
      params.nodeOrder.map((nodeKey, index) => [nodeKey, index]),
    );
    this.nodeKeySet = new Set(params.nodeOrder);
  }

  abstract buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): State;
  abstract getNodeOutput(
    nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
  ): Record<string, unknown>;
  abstract getNodeEventPayload(
    nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
  ): Record<string, unknown>;
  abstract mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ): WorkflowGraphState;
  abstract getRunResult(state: WorkflowGraphState): Record<string, unknown>;

  getNodeOrder(): string[] {
    return [...this.nodeOrder];
  }

  protected getSkippedNodes(
    _nodeKey: NodeKey,
    _state: State,
  ): WorkflowGraphSkip<NodeKey>[] {
    return [];
  }

  protected getResumeNodeKey(startNodeIndex?: number): NodeKey | undefined {
    if (startNodeIndex === undefined) {
      return undefined;
    }

    return this.nodeOrder[startNodeIndex];
  }

  private isTrackableNode(nodeKey: string): nodeKey is NodeKey {
    return this.nodeKeySet.has(nodeKey);
  }

  private getProgressPercent(nodeKey: NodeKey, fallback: number) {
    const index = this.nodeIndex.get(nodeKey);
    if (index === undefined || this.nodeOrder.length === 0) {
      return fallback;
    }

    return Math.round(((index + 1) / this.nodeOrder.length) * 100);
  }

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
  }): Promise<WorkflowGraphState> {
    let state = {
      ...(params.initialState as State),
      errors: (params.initialState.errors ?? []) as string[],
    };

    if (this.nodeOrder.length === 0) {
      return state;
    }

    const resumeFromNodeKey = this.getResumeNodeKey(params.startNodeIndex);
    if (resumeFromNodeKey) {
      state = {
        ...state,
        resumeFromNodeKey,
      };
    }

    const stream = await this.graph.stream(state, {
      streamMode: ["tasks", "values"],
    });

    const pendingNodes: NodeKey[] = [];
    const startedNodes = new Set<NodeKey>();
    const completedNodes = new Set<NodeKey>();
    const skippedNodes = new Set<NodeKey>();

    const handleSkip = async (skip: WorkflowGraphSkip<NodeKey>) => {
      if (completedNodes.has(skip.nodeKey) || skippedNodes.has(skip.nodeKey)) {
        return;
      }

      const progressPercent = this.getProgressPercent(
        skip.nodeKey,
        state.progressPercent,
      );

      state = {
        ...state,
        currentNodeKey: skip.nodeKey,
        lastCompletedNodeKey: skip.nodeKey,
        progressPercent,
      };

      skippedNodes.add(skip.nodeKey);

      await params.hooks?.onNodeSkipped?.(skip.nodeKey, state, {
        reason: skip.reason,
        ...this.getNodeEventPayload(skip.nodeKey, state),
        ...(skip.payload ?? {}),
      });
    };

    try {
      for await (const chunk of stream) {
        const parsed = parseStreamChunk(chunk);
        if (!parsed) {
          continue;
        }

        if (parsed.mode === "tasks" && isTaskPayload(parsed.payload)) {
          const task = parsed.payload;
          if (!this.isTrackableNode(task.name)) {
            continue;
          }

          const nodeKey = task.name;

          if (isTaskResult(task)) {
            if (!completedNodes.has(nodeKey) && !skippedNodes.has(nodeKey)) {
              pendingNodes.push(nodeKey);
            }
            continue;
          }

          if (
            startedNodes.has(nodeKey) ||
            completedNodes.has(nodeKey) ||
            skippedNodes.has(nodeKey)
          ) {
            continue;
          }

          startedNodes.add(nodeKey);
          state = {
            ...state,
            currentNodeKey: nodeKey,
          };

          await params.hooks?.onNodeStarted?.(nodeKey);
          await params.hooks?.onNodeProgress?.(nodeKey, {
            message: "Node is running",
          });
          continue;
        }

        if (parsed.mode === "values" && parsed.payload) {
          if (typeof parsed.payload === "object") {
            state = {
              ...state,
              ...(parsed.payload as State),
            };
          }

          if (pendingNodes.length === 0) {
            continue;
          }

          const completedBatch = pendingNodes.splice(0);

          for (const nodeKey of completedBatch) {
            const progressPercent = this.getProgressPercent(
              nodeKey,
              state.progressPercent,
            );

            state = {
              ...state,
              currentNodeKey: nodeKey,
              lastCompletedNodeKey: nodeKey,
              progressPercent,
            };

            completedNodes.add(nodeKey);

            await params.hooks?.onNodeSucceeded?.(nodeKey, state);

            const skipCandidates = this.getSkippedNodes(nodeKey, state).filter(
              (skip) =>
                !completedNodes.has(skip.nodeKey) &&
                !skippedNodes.has(skip.nodeKey),
            );

            for (const skip of skipCandidates) {
              await handleSkip(skip);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof WorkflowPauseError) {
        throw new WorkflowPauseError(
          error.message,
          error.reason,
          error.state ?? state,
        );
      }

      throw error;
    }

    return state;
  }
}
