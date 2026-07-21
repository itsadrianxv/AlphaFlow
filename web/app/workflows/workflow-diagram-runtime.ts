import { formatWorkflowDiagramNodeLabel } from "~/app/workflows/detail-labels";
import type {
  WorkflowDiagramNodeRuntimeState,
  WorkflowDiagramNodeStatus,
  WorkflowDiagramRuntimeState,
  WorkflowDiagramSpec,
  WorkflowDiagramVisitedEdge,
} from "~/app/workflows/workflow-diagram";
import { parseWorkflowNodeInsight } from "~/contracts/workflow-node-insight";

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

export type WorkflowDiagramLiveEvent = {
  sequence: number;
  eventType: string;
  nodeKey?: string;
  progressPercent?: number;
  payload?: Record<string, unknown>;
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

function getEventMessage(event: WorkflowEventInfo) {
  if (!isRecord(event.payload) || typeof event.payload.message !== "string") {
    return undefined;
  }

  const message = event.payload.message.trim();
  return message.length > 0 ? message.slice(0, 240) : undefined;
}

function getLatestNodeEvent(events: WorkflowEventInfo[], nodeKey: string) {
  return events
    .filter((event) => getEventNodeKey(event) === nodeKey)
    .sort((left, right) => right.sequence - left.sequence)
    .at(0);
}

function getNodeStatusFromEvent(event?: WorkflowEventInfo) {
  if (!event) {
    return undefined;
  }

  if (
    event.eventType === "NODE_STARTED" ||
    event.eventType === "NODE_PROGRESS"
  ) {
    return "active" as const;
  }

  if (event.eventType === "NODE_SUCCEEDED") {
    return isRecord(event.payload) && event.payload.skipped === true
      ? ("skipped" as const)
      : ("done" as const);
  }

  if (event.eventType === "NODE_FAILED") {
    return "failed" as const;
  }

  if (event.eventType === "RUN_PAUSED") {
    return "paused" as const;
  }

  return undefined;
}

function mergeEvents(params: {
  run: WorkflowDiagramRunDetail;
  liveEvents?: WorkflowDiagramLiveEvent[];
}) {
  const events = new Map<number, WorkflowEventInfo>();

  for (const event of params.run.events) {
    events.set(event.sequence, event);
  }

  for (const event of params.liveEvents ?? []) {
    events.set(event.sequence, {
      id: `live-${event.sequence}`,
      sequence: event.sequence,
      eventType: event.eventType,
      payload: event.nodeKey
        ? { ...(event.payload ?? {}), nodeKey: event.nodeKey }
        : event.payload,
      occurredAt: event.occurredAt,
    });
  }

  return [...events.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function getInsightFromOutput(output: unknown) {
  if (!isRecord(output)) {
    return undefined;
  }

  const parsed = parseWorkflowNodeInsight(output.insight);
  return parsed.success ? parsed.data : undefined;
}

function getPausedNodeInsight(params: {
  run: WorkflowDiagramRunDetail;
  nodeKey: string;
}) {
  const event = [...params.run.events]
    .sort((left, right) => right.sequence - left.sequence)
    .find(
      (item) =>
        item.eventType === "RUN_PAUSED" &&
        getEventNodeKey(item) === params.nodeKey,
    );

  if (!event || !isRecord(event.payload)) {
    return undefined;
  }

  const parsed = parseWorkflowNodeInsight(event.payload.insight);
  return parsed.success ? parsed.data : undefined;
}

function getNodeStatus(params: {
  runStatus: WorkflowRunStatus;
  currentNodeKey?: string | null;
  nodeKey: string;
  nodeRun?: WorkflowNodeInfo;
  latestEvent?: WorkflowEventInfo;
}): WorkflowDiagramNodeStatus {
  const eventStatus = getNodeStatusFromEvent(params.latestEvent);
  if (eventStatus) {
    return eventStatus;
  }

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
      label: formatWorkflowDiagramNodeLabel(node.nodeKey),
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
  liveEvents?: WorkflowDiagramLiveEvent[];
}): WorkflowDiagramRuntimeState {
  const events = mergeEvents({
    run: params.run,
    liveEvents: params.liveEvents,
  });

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
              latestEvent: getLatestNodeEvent(events, node.nodeKey),
            }),
            startedAt: node.startedAt,
            completedAt: node.completedAt,
            durationMs: node.durationMs,
            attempt: node.attempt,
            errorCode: node.errorCode,
            errorMessage: node.errorMessage,
            output: node.output,
            insight: getInsightFromOutput(node.output),
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
      const latestEvent = getLatestNodeEvent(events, node.id);
      const status = getNodeStatus({
        runStatus: params.run.status,
        currentNodeKey: params.run.currentNodeKey,
        nodeKey: node.id,
        nodeRun,
        latestEvent,
      });
      const latestProgress =
        status === "active" || status === "paused"
          ? [...events]
              .reverse()
              .find(
                (event) =>
                  event.eventType === "NODE_PROGRESS" &&
                  getEventNodeKey(event) === node.id &&
                  Boolean(getEventMessage(event)),
              )
          : undefined;

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
          insight:
            getInsightFromOutput(nodeRun?.output) ??
            getPausedNodeInsight({ run: params.run, nodeKey: node.id }),
          eventSummary: latestEvent?.eventType,
          latestProgress: latestProgress
            ? {
                message: getEventMessage(latestProgress) as string,
                occurredAt: latestProgress.occurredAt,
              }
            : undefined,
        } satisfies WorkflowDiagramNodeRuntimeState,
      ];
    }),
  ) as Record<string, WorkflowDiagramNodeRuntimeState>;

  const visitedNodeIds = Object.entries(nodeStates)
    .filter(([, state]) => state.status !== "idle")
    .map(([nodeId]) => nodeId);
  const activeNodeId = [...events]
    .reverse()
    .map((event) => getEventNodeKey(event))
    .filter((nodeKey): nodeKey is string => Boolean(nodeKey))
    .find(
      (nodeKey) =>
        nodeStates[nodeKey]?.status === "active" ||
        nodeStates[nodeKey]?.status === "paused",
    );

  return {
    currentNodeId: activeNodeId ?? params.run.currentNodeKey ?? null,
    nodeStates,
    visitedNodeIds,
    visitedEdges: deriveVisitedEdges({
      spec: params.spec,
      nodeStates,
      events,
    }),
    fallback: null,
  };
}
