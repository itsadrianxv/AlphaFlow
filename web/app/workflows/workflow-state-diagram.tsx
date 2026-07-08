"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useMemo, useState } from "react";
import { cn, InlineNotice, StatusPill } from "~/app/_components/ui";
import type {
  WorkflowDiagramNode,
  WorkflowDiagramNodeRuntimeState,
  WorkflowDiagramRuntimeState,
  WorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram";

type WorkflowStateDiagramProps = {
  spec: WorkflowDiagramSpec | null;
  runtime: WorkflowDiagramRuntimeState;
};

const statusLabelMap: Record<string, string> = {
  idle: "待执行",
  active: "进行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

const statusToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  idle: "neutral",
  active: "info",
  paused: "warning",
  done: "success",
  failed: "danger",
  skipped: "neutral",
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

function compactValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  } catch {
    return "-";
  }
}

function getNodeState(
  runtime: WorkflowDiagramRuntimeState,
  nodeId: string,
): WorkflowDiagramNodeRuntimeState {
  return runtime.nodeStates[nodeId] ?? { status: "idle" };
}

function NodeInspector(props: {
  node: WorkflowDiagramNode | null;
  state?: WorkflowDiagramNodeRuntimeState;
}) {
  const { node, state } = props;

  if (!node) {
    return (
      <div className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
        <div className="text-sm font-medium text-[var(--app-text-strong)]">
          节点详情
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
          选择一个节点，查看状态、时序和输出摘要。
        </p>
      </div>
    );
  }

  const status = state?.status ?? "idle";

  return (
    <div
      className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4"
      data-node-inspector="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--app-text-strong)]">
            节点详情
          </div>
          <div className="mt-1 text-sm text-[var(--app-text)]">
            {node.label}
          </div>
        </div>
        <StatusPill
          label={statusLabelMap[status] ?? status}
          tone={statusToneMap[status] ?? "neutral"}
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--app-text-muted)] md:grid-cols-2 xl:grid-cols-4">
        <div>节点键：{node.id}</div>
        <div>节点类型：{node.kind}</div>
        <div>执行次数：{state?.attempt ?? "-"}</div>
        <div>耗时：{state?.durationMs ?? "-"} ms</div>
        <div>开始时间：{formatDate(state?.startedAt)}</div>
        <div>完成时间：{formatDate(state?.completedAt)}</div>
        <div>最近事件：{state?.eventSummary ?? "-"}</div>
        <div>错误信息：{state?.errorCode ?? state?.errorMessage ?? "-"}</div>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
        {node.description}
      </p>
      {state?.output !== undefined ? (
        <pre className="mt-3 overflow-auto border border-[var(--app-border-soft)] bg-[var(--app-code-bg)] p-3 text-xs leading-5 text-[var(--app-text-muted)]">
          {compactValue(state.output)}
        </pre>
      ) : null}
    </div>
  );
}

function FallbackDiagram(props: { runtime: WorkflowDiagramRuntimeState }) {
  const fallback = props.runtime.fallback;

  if (!fallback) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <InlineNotice tone="warning" description={fallback.notice} />
      <div className="grid gap-2" data-workflow-state-diagram="fallback">
        {fallback.orderedNodes.map((node) => (
          <div
            key={node.id}
            className="flex items-center justify-between gap-3 border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3"
            data-node-id={node.id}
            data-node-status={node.status}
          >
            <span className="text-sm text-[var(--app-text)]">{node.label}</span>
            <StatusPill
              label={statusLabelMap[node.status] ?? node.status}
              tone={statusToneMap[node.status] ?? "neutral"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkflowStateDiagram(props: WorkflowStateDiagramProps) {
  const { spec, runtime } = props;
  const initialSelectedNodeId =
    runtime.currentNodeId ?? spec?.nodes[0]?.id ?? null;
  const [selectedNodeId, setSelectedNodeId] = useState(initialSelectedNodeId);

  const selectedNode = useMemo(() => {
    if (!spec || !selectedNodeId) {
      return null;
    }

    return spec.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, spec]);

  if (!spec) {
    return <FallbackDiagram runtime={runtime} />;
  }

  const visitedEdgeKeys = new Set(
    runtime.visitedEdges.map((edge) => `${edge.from}->${edge.to}`),
  );
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node] as const));

  return (
    <div className="grid gap-4">
      <div
        className="overflow-auto border border-[var(--app-border-soft)] bg-[var(--app-surface)]"
        data-workflow-state-diagram="true"
      >
        <div
          className="relative"
          style={{
            minWidth: spec.layout.width,
            height: spec.layout.height,
          }}
        >
          {spec.lanes.map((lane) => (
            <div
              key={lane.id}
              className="absolute left-0 right-0 border-b border-[var(--app-border-soft)] bg-[var(--app-panel-soft)]"
              style={{
                top: lane.y,
                height: lane.height,
              }}
            >
              <div className="px-3 py-2 text-xs text-[var(--app-text-subtle)]">
                {lane.label}
              </div>
            </div>
          ))}
          <svg
            aria-hidden="true"
            className="absolute inset-0"
            width={spec.layout.width}
            height={spec.layout.height}
          >
            <defs>
              <marker
                id="workflow-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            {spec.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) {
                return null;
              }

              const visited = visitedEdgeKeys.has(`${edge.from}->${edge.to}`);
              const x1 = from.x + from.width;
              const y1 = from.y + from.height / 2;
              const x2 = to.x;
              const y2 = to.y + to.height / 2;
              const midX = x1 + Math.max(24, (x2 - x1) / 2);

              return (
                <g
                  key={`${edge.from}-${edge.to}-${edge.label ?? "default"}`}
                  className={
                    visited
                      ? "text-[var(--app-accent-strong)]"
                      : "text-[var(--app-border-strong)]"
                  }
                >
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={visited ? 2.5 : 1.2}
                    markerEnd="url(#workflow-arrow)"
                    opacity={visited ? 1 : 0.5}
                  />
                  {edge.label ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      className="fill-[var(--app-text-subtle)] text-[11px]"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {spec.nodes.map((node) => {
            const state = getNodeState(runtime, node.id);
            const active =
              state.status === "active" ||
              state.status === "paused" ||
              selectedNodeId === node.id;

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedNodeId(node.id)}
                className={cn(
                  "absolute border bg-[var(--app-surface)] px-3 py-2 text-left transition-colors",
                  active
                    ? "border-[var(--app-border-strong)] text-[var(--app-text-strong)]"
                    : "border-[var(--app-border-soft)] text-[var(--app-text-muted)]",
                  state.status === "failed" &&
                    "border-[var(--app-danger-border)] bg-[var(--app-danger-surface)]",
                  state.status === "done" &&
                    "border-[var(--app-success-border)] bg-[var(--app-success-surface)]",
                  state.status === "paused" &&
                    "border-[var(--app-warning-border)] bg-[var(--app-warning-surface)]",
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  minHeight: node.height,
                }}
                data-node-id={node.id}
                data-node-status={state.status}
              >
                <div className="text-sm font-medium leading-5">
                  {node.label}
                </div>
                <div className="mt-1 text-[11px] leading-4 text-[var(--app-text-subtle)]">
                  {node.id}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <NodeInspector
        node={selectedNode}
        state={
          selectedNode ? getNodeState(runtime, selectedNode.id) : undefined
        }
      />
    </div>
  );
}
