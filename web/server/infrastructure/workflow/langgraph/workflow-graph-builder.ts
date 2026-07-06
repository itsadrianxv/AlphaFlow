import { END, START, type StateGraph } from "@langchain/langgraph";
import type {
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";

type NodeExecutor<State extends Record<string, unknown>> = (
  state: State,
) => Promise<Partial<State>>;

type ResumableState = WorkflowGraphState & {
  resumeFromNodeKey?: WorkflowNodeKey;
};

export function addWorkflowNodes<
  State extends Record<string, unknown>,
  NodeKey extends string,
>(
  graph: StateGraph<unknown, State, Partial<State>, string>,
  nodeOrder: readonly NodeKey[],
  nodeExecutors: Record<NodeKey, NodeExecutor<State>>,
) {
  for (const nodeKey of nodeOrder) {
    // LangGraph's generic NodeAction typing is narrower than our partial state updates.
    graph.addNode(nodeKey, (async (state: State) =>
      nodeExecutors[nodeKey](state)) as never);
  }
}

export function addResumeStart<
  State extends ResumableState,
  NodeKey extends string,
>(
  graph: StateGraph<unknown, State, Partial<State>, string>,
  nodeOrder: readonly NodeKey[],
) {
  if (nodeOrder.length === 0) {
    return;
  }

  const firstNode = nodeOrder[0] as NodeKey;

  graph.addConditionalEdges(START, (state: State) => {
    const resumeNode = state.resumeFromNodeKey;

    if (typeof resumeNode === "string") {
      const match = nodeOrder.find((nodeKey) => nodeKey === resumeNode);
      if (match) {
        return match;
      }
    }

    return firstNode;
  });
}

export function addSequentialEdges<State, NodeKey extends string>(
  graph: StateGraph<unknown, State, Partial<State>, string>,
  nodeOrder: readonly NodeKey[],
) {
  if (nodeOrder.length === 0) {
    return;
  }

  for (let index = 0; index < nodeOrder.length - 1; index += 1) {
    const current = nodeOrder[index];
    const next = nodeOrder[index + 1];

    if (!current || !next) {
      continue;
    }

    graph.addEdge(current, next);
  }

  const lastNode = nodeOrder[nodeOrder.length - 1];

  if (lastNode) {
    graph.addEdge(lastNode, END);
  }
}

export function addFanOutAndJoinEdges<State, NodeKey extends string>(
  graph: StateGraph<unknown, State, Partial<State>, string>,
  params: {
    startNode: NodeKey;
    parallelNodes: readonly NodeKey[];
    joinNode: NodeKey;
  },
) {
  for (const nodeKey of params.parallelNodes) {
    graph.addEdge(params.startNode, nodeKey);
  }

  if (params.parallelNodes.length > 0) {
    graph.addEdge([...params.parallelNodes], params.joinNode);
  }
}
