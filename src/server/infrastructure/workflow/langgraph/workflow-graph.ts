import type {
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";

export type WorkflowGraphExecutionHooks = {
  onNodeStarted?: (nodeKey: WorkflowNodeKey) => Promise<void> | void;
  onNodeProgress?: (
    nodeKey: WorkflowNodeKey,
    payload: Record<string, unknown>,
  ) => Promise<void> | void;
  onNodeSkipped?: (
    nodeKey: WorkflowNodeKey,
    updatedState: WorkflowGraphState,
    payload: Record<string, unknown>,
  ) => Promise<void> | void;
  onNodeSucceeded?: (
    nodeKey: WorkflowNodeKey,
    updatedState: WorkflowGraphState,
  ) => Promise<void> | void;
};

export type WorkflowGraphBuildInitialStateParams = {
  runId: string;
  userId: string;
  query: string;
  input: Record<string, unknown>;
  progressPercent: number;
};

export interface WorkflowGraphRunner {
  readonly templateCode: string;
  getNodeOrder(): string[];
  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): WorkflowGraphState;
  getNodeOutput(
    nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
  ): Record<string, unknown>;
  getNodeEventPayload(
    nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
  ): Record<string, unknown>;
  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ): WorkflowGraphState;
  getRunResult(state: WorkflowGraphState): Record<string, unknown>;
  execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
  }): Promise<WorkflowGraphState>;
}
