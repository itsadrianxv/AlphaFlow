export type WorkflowDiagramNodeKind = "agent" | "tool" | "system" | "gate";

export type WorkflowDiagramLane = {
  id: string;
  label: string;
  y: number;
  height: number;
};

export type WorkflowDiagramNode = {
  id: string;
  label: string;
  description: string;
  kind: WorkflowDiagramNodeKind;
  laneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkflowDiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

export type WorkflowDiagramLayout = {
  width: number;
  height: number;
};

export type WorkflowDiagramSpec = {
  templateCode: string;
  templateVersion: number;
  title: string;
  lanes: WorkflowDiagramLane[];
  nodes: WorkflowDiagramNode[];
  edges: WorkflowDiagramEdge[];
  layout: WorkflowDiagramLayout;
};

export type WorkflowDiagramNodeStatus =
  | "idle"
  | "active"
  | "paused"
  | "done"
  | "failed"
  | "skipped";

export type WorkflowDiagramNodeRuntimeState = {
  status: WorkflowDiagramNodeStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  attempt?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  output?: unknown;
  eventSummary?: string;
};

export type WorkflowDiagramVisitedEdge = {
  from: string;
  to: string;
};

export type WorkflowDiagramFallbackNode = {
  id: string;
  label: string;
  status: WorkflowDiagramNodeStatus;
};

export type WorkflowDiagramRuntimeState = {
  currentNodeId: string | null;
  nodeStates: Record<string, WorkflowDiagramNodeRuntimeState>;
  visitedNodeIds: string[];
  visitedEdges: WorkflowDiagramVisitedEdge[];
  fallback: {
    notice: string;
    orderedNodes: WorkflowDiagramFallbackNode[];
  } | null;
};
