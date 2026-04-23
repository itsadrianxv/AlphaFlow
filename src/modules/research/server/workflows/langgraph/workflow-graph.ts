import type {
  FlowSpec,
  NodeError,
  NodeResult,
  NodeResultStatus,
  NodeRoute,
} from "~/modules/research/server/domain/workflow/flow-spec";
import type {
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/modules/research/server/domain/workflow/types";

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
  templateGraphConfig?: unknown;
};

export type BuildNodeResultParams = {
  status?: NodeResultStatus;
  route?: NodeRoute;
  error?: NodeError | null;
  note?: string;
};

export interface WorkflowGraphRunner {
  readonly templateCode: string;
  readonly templateVersion?: number;
  readonly spec: FlowSpec;
  getNodeOrder(): string[];
  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): WorkflowGraphState;
  buildNodeResult(
    nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
    params?: BuildNodeResultParams,
  ): NodeResult;
  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    result: NodeResult,
  ): WorkflowGraphState;
  getRunResult(state: WorkflowGraphState): Record<string, unknown>;
  execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
  }): Promise<WorkflowGraphState>;
}
