import type {
  FlowMap,
  FlowMapNode,
  FlowSpec,
  NodeResult,
} from "~/modules/research/server/domain/workflow/flow-spec";
import { parseNodeResult } from "~/modules/research/server/domain/workflow/flow-spec";
import { buildFlowMap } from "~/modules/research/server/domain/workflow/flow-specs";

type RunStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
type NodeRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "SKIPPED" | "FAILED";

type RunInfo = {
  id: string;
  status: RunStatus;
  progressPercent: number;
  currentNodeKey?: string | null;
  result: unknown;
};

type NodeRunInfo = {
  id: string;
  nodeKey: string;
  status: NodeRunStatus;
  output: unknown;
};

type EventInfo = {
  id?: string;
  sequence?: number;
  eventType?: string;
  payload?: unknown;
  occurredAt?: Date | string;
};

export type RunNodeState =
  | "idle"
  | "active"
  | "paused"
  | "done"
  | "failed"
  | "skipped";

export type RunNodeView = FlowMapNode & {
  state: RunNodeState;
  result: NodeResult | null;
  note: string;
  stats: Record<string, unknown>;
};

export type RunGraphView = {
  nodes: RunNodeView[];
  edges: FlowMap["edges"];
  stages: FlowMap["stages"];
  activePath: string[];
  current: RunNodeView | null;
};

export type RunView = {
  flow: {
    templateCode: string;
    templateVersion?: number;
    name: string;
  };
  user: RunGraphView;
  debug: RunGraphView & {
    events: EventInfo[];
  };
  status: RunStatus;
  progressPercent: number;
  result: unknown;
};

function buildNodeRunMap(nodeRuns: NodeRunInfo[]) {
  return new Map(
    nodeRuns.map((nodeRun) => [nodeRun.nodeKey, nodeRun] as const),
  );
}

function resolveNodeState(params: {
  runStatus: RunStatus;
  currentNodeKey?: string | null;
  nodeRun?: NodeRunInfo;
  nodeKey: string;
}): RunNodeState {
  if (params.currentNodeKey === params.nodeKey) {
    if (params.runStatus === "PAUSED") {
      return "paused";
    }

    if (params.runStatus === "RUNNING" || params.runStatus === "PENDING") {
      return "active";
    }

    if (params.runStatus === "FAILED") {
      return "failed";
    }
  }

  switch (params.nodeRun?.status) {
    case "SUCCEEDED":
      return "done";
    case "SKIPPED":
      return "skipped";
    case "FAILED":
      return "failed";
    case "RUNNING":
      return "active";
    default:
      return "idle";
  }
}

function buildActivePath(spec: FlowSpec, graph: RunGraphView, run: RunInfo) {
  const pivotKey =
    run.currentNodeKey ??
    [...graph.nodes]
      .reverse()
      .find((node) => node.state === "done" || node.state === "paused")?.key;

  if (!pivotKey) {
    return [];
  }

  const visibleKeys = new Set(graph.nodes.map((node) => node.key));
  const pivotIndex = spec.nodes.findIndex((node) => node.key === pivotKey);

  if (pivotIndex < 0) {
    return [];
  }

  return spec.nodes
    .slice(0, pivotIndex + 1)
    .filter((node) => visibleKeys.has(node.key))
    .map((node) => node.key);
}

function buildGraphView(params: {
  spec: FlowSpec;
  flowMap: FlowMap;
  run: RunInfo;
  nodeRuns: NodeRunInfo[];
}) {
  const nodeRunMap = buildNodeRunMap(params.nodeRuns);
  const nodes: RunNodeView[] = params.flowMap.nodes.map((node) => {
    const nodeRun = nodeRunMap.get(node.key);
    const result = parseNodeResult(nodeRun?.output);
    return {
      ...node,
      state: resolveNodeState({
        runStatus: params.run.status,
        currentNodeKey: params.run.currentNodeKey,
        nodeRun,
        nodeKey: node.key,
      }),
      result,
      note: result?.note ?? "",
      stats: result?.stats ?? {},
    };
  });

  const graph: RunGraphView = {
    nodes,
    edges: params.flowMap.edges,
    stages: params.flowMap.stages,
    activePath: [],
    current: null,
  };

  graph.activePath = buildActivePath(params.spec, graph, params.run);
  graph.current =
    nodes.find((node) => node.state === "active" || node.state === "paused") ??
    null;

  return graph;
}

export function buildRunView(params: {
  flow: FlowSpec;
  run: RunInfo;
  nodeRuns: NodeRunInfo[];
  events: EventInfo[];
}) {
  const flow = params.flow;

  const userMap = buildFlowMap(flow, "user");
  const debugMap = buildFlowMap(flow, "debug");

  return {
    flow: {
      templateCode: flow.templateCode,
      templateVersion: flow.templateVersion,
      name: flow.name,
    },
    user: buildGraphView({
      spec: flow,
      flowMap: userMap,
      run: params.run,
      nodeRuns: params.nodeRuns,
    }),
    debug: {
      ...buildGraphView({
        spec: flow,
        flowMap: debugMap,
        run: params.run,
        nodeRuns: params.nodeRuns,
      }),
      events: params.events,
    },
    status: params.run.status,
    progressPercent: params.run.progressPercent,
    result: params.run.result,
  } satisfies RunView;
}
