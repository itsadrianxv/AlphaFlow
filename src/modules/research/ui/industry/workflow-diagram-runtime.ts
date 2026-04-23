import type {
  WorkflowDiagramNodeRuntimeState,
  WorkflowDiagramNodeStatus,
  WorkflowDiagramRuntimeState,
  WorkflowDiagramSpec,
  WorkflowDiagramVisitedEdge,
} from "~/modules/research/ui/industry/workflow-diagram";

type WorkflowNodeRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "SKIPPED"
  | "FAILED";

type WorkflowRunStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

type WorkflowEventInfo = {
  id: string;
  sequence: number;
  eventType: string;
  payload?: unknown;
  occurredAt: Date | string;
};

type WorkflowNodeInfo = {
  id: string;
  nodeKey: string;
  agentName: string;
  attempt: number;
  status: WorkflowNodeRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  output: unknown;
};

export type WorkflowDiagramRunDetail = {
  id: string;
  query?: string;
  status: WorkflowRunStatus;
  progressPercent: number;
  currentNodeKey?: string | null;
  input: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
  template: {
    code: string;
    version?: number;
  };
  createdAt: Date | string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  nodes: WorkflowNodeInfo[];
  events: WorkflowEventInfo[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEventNodeKey(event: WorkflowEventInfo) {
  return isRecord(event.payload) && typeof event.payload.nodeKey === "string"
    ? event.payload.nodeKey
    : undefined;
}

function getNodeStatus(params: {
  runStatus: WorkflowRunStatus;
  currentNodeKey?: string | null;
  nodeKey: string;
  nodeRun?: WorkflowNodeInfo;
}): WorkflowDiagramNodeStatus {
  if (params.currentNodeKey === params.nodeKey) {
    if (params.runStatus === "PAUSED") {
      return "paused";
    }

    if (params.runStatus === "RUNNING" || params.runStatus === "PENDING") {
      return "active";
    }
  }

  switch (params.nodeRun?.status) {
    case "RUNNING":
      return "active";
    case "SUCCEEDED":
      return "done";
    case "SKIPPED":
      return "skipped";
    case "FAILED":
      return "failed";
    default:
      return "idle";
  }
}

function pushVisitedEdge(
  list: WorkflowDiagramVisitedEdge[],
  edge: WorkflowDiagramVisitedEdge,
) {
  if (list.some((item) => item.from === edge.from && item.to === edge.to)) {
    return;
  }

  list.push(edge);
}

function deriveVisitedEdges(params: {
  spec: WorkflowDiagramSpec;
  nodeStates: Record<string, WorkflowDiagramNodeRuntimeState>;
  events: WorkflowEventInfo[];
}) {
  const visitedEdges: WorkflowDiagramVisitedEdge[] = [];
  const relevantStatuses = new Set([
    "done",
    "active",
    "paused",
    "failed",
    "skipped",
  ]);

  for (const edge of params.spec.edges) {
    const fromState = params.nodeStates[edge.from]?.status;
    const toState = params.nodeStates[edge.to]?.status;

    if (
      fromState &&
      toState &&
      relevantStatuses.has(fromState) &&
      relevantStatuses.has(toState)
    ) {
      pushVisitedEdge(visitedEdges, {
        from: edge.from,
        to: edge.to,
      });
    }
  }

  const startedNodeKeys = new Set(
    params.events
      .filter((event) => event.eventType === "NODE_STARTED")
      .map((event) => getEventNodeKey(event))
      .filter((nodeKey): nodeKey is string => Boolean(nodeKey)),
  );

  for (const edge of params.spec.edges) {
    if (
      startedNodeKeys.has(edge.from) &&
      params.nodeStates[edge.to]?.status &&
      params.nodeStates[edge.to]?.status !== "idle"
    ) {
      pushVisitedEdge(visitedEdges, {
        from: edge.from,
        to: edge.to,
      });
    }
  }

  const sortedEvents = [...params.events].sort(
    (left, right) => left.sequence - right.sequence,
  );

  let lastNodeKey: string | null = null;

  for (const event of sortedEvents) {
    const nodeKey = getEventNodeKey(event);
    if (!nodeKey) {
      continue;
    }

    if (
      event.eventType === "NODE_STARTED" &&
      lastNodeKey &&
      lastNodeKey !== nodeKey
    ) {
      pushVisitedEdge(visitedEdges, {
        from: lastNodeKey,
        to: nodeKey,
      });
    }

    if (
      event.eventType === "NODE_SUCCEEDED" ||
      event.eventType === "NODE_FAILED"
    ) {
      lastNodeKey = nodeKey;
    }
  }

  return visitedEdges;
}

function buildFallback(run: WorkflowDiagramRunDetail) {
  if (run.nodes.length === 0) {
    return {
      notice: `未找到 ${run.template.code}@${run.template.version ?? "latest"} 对应的状态图配置。`,
      orderedNodes: [],
    };
  }

  return {
    notice: `未找到 ${run.template.code}@${run.template.version ?? "latest"} 对应的状态图配置。`,
    orderedNodes: run.nodes.map((node) => ({
      id: node.nodeKey,
      label: node.nodeKey,
      status: getNodeStatus({
        runStatus: run.status,
        currentNodeKey: run.currentNodeKey,
        nodeKey: node.nodeKey,
        nodeRun: node,
      }),
    })),
  };
}

export function buildWorkflowDiagramRuntimeState(params: {
  spec: WorkflowDiagramSpec | null;
  run: WorkflowDiagramRunDetail;
}): WorkflowDiagramRuntimeState {
  if (!params.spec) {
    return {
      currentNodeId: params.run.currentNodeKey ?? null,
      nodeStates: Object.fromEntries(
        params.run.nodes.map((node) => [
          node.nodeKey,
          {
            status: getNodeStatus({
              runStatus: params.run.status,
              currentNodeKey: params.run.currentNodeKey,
              nodeKey: node.nodeKey,
              nodeRun: node,
            }),
            startedAt: node.startedAt,
            completedAt: node.completedAt,
            durationMs: node.durationMs,
            attempt: node.attempt,
            errorCode: node.errorCode,
            errorMessage: node.errorMessage,
            output: node.output,
          },
        ]),
      ),
      visitedNodeIds: params.run.nodes.map((node) => node.nodeKey),
      visitedEdges: [],
      fallback: buildFallback(params.run),
    };
  }

  const nodeRunMap = new Map(
    params.run.nodes.map((node) => [node.nodeKey, node] as const),
  );

  const nodeStates = Object.fromEntries(
    params.spec.nodes.map((node) => {
      const nodeRun = nodeRunMap.get(node.id);
      const status = getNodeStatus({
        runStatus: params.run.status,
        currentNodeKey: params.run.currentNodeKey,
        nodeKey: node.id,
        nodeRun,
      });
      const eventSummary =
        params.run.events
          .filter((event) => getEventNodeKey(event) === node.id)
          .slice(-1)
          .map((event) => event.eventType)
          .at(0) ?? undefined;

      return [
        node.id,
        {
          status,
          startedAt: nodeRun?.startedAt,
          completedAt: nodeRun?.completedAt,
          durationMs: nodeRun?.durationMs,
          attempt: nodeRun?.attempt,
          errorCode: nodeRun?.errorCode,
          errorMessage: nodeRun?.errorMessage,
          output: nodeRun?.output,
          eventSummary,
        } satisfies WorkflowDiagramNodeRuntimeState,
      ];
    }),
  ) as Record<string, WorkflowDiagramNodeRuntimeState>;

  const visitedNodeIds = Object.entries(nodeStates)
    .filter(([, state]) => state.status !== "idle")
    .map(([nodeId]) => nodeId);

  return {
    currentNodeId: params.run.currentNodeKey ?? null,
    nodeStates,
    visitedNodeIds,
    visitedEdges: deriveVisitedEdges({
      spec: params.spec,
      nodeStates,
      events: params.run.events,
    }),
    fallback: null,
  };
}
