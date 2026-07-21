"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn, InlineNotice, StatusPill } from "~/app/_components/ui";
import { formatWorkflowDiagramNodeLabel } from "~/app/workflows/detail-labels";
import type {
  WorkflowDiagramNode,
  WorkflowDiagramNodeRuntimeState,
  WorkflowDiagramRuntimeState,
  WorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram";
import type {
  WorkflowNodeInsight,
  WorkflowNodeInsightField,
} from "~/contracts/workflow-node-insight";

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

function getNodeState(
  runtime: WorkflowDiagramRuntimeState,
  nodeId: string,
): WorkflowDiagramNodeRuntimeState {
  return runtime.nodeStates[nodeId] ?? { status: "idle" };
}

function InsightFieldValue(props: { field: WorkflowNodeInsightField }) {
  const { field } = props;
  const value = field.value;

  if (value.kind === "text") {
    return (
      <p className="text-sm leading-6 text-[var(--app-text)]">{value.text}</p>
    );
  }

  if (value.kind === "list") {
    return (
      <ul className="grid gap-1.5 text-sm leading-6 text-[var(--app-text)]">
        {value.items.map((item) => (
          <li
            key={`${field.label}-${item}`}
            className="relative pl-3 before:absolute before:ml-[-0.75rem] before:text-[var(--app-text-subtle)] before:content-['-']"
          >
            {item}
          </li>
        ))}
      </ul>
    );
  }

  if (value.kind === "key_values") {
    return (
      <dl className="grid gap-x-4 gap-y-1.5 text-sm leading-6 sm:grid-cols-[minmax(96px,0.45fr)_minmax(0,1fr)]">
        {value.items.map((item) => (
          <React.Fragment key={`${field.label}-${item.label}`}>
            <dt className="text-[var(--app-text-subtle)]">{item.label}</dt>
            <dd className="text-[var(--app-text)]">{item.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }

  return (
    <div className="overflow-x-auto border border-[var(--app-border-soft)]">
      <table className="w-full border-collapse text-left text-xs leading-5 text-[var(--app-text)]">
        <thead className="bg-[var(--app-panel-soft)] text-[var(--app-text-subtle)]">
          <tr>
            {value.columns.map((column) => (
              <th
                key={column}
                className="border-b border-[var(--app-border-soft)] px-2 py-1.5 font-medium"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.rows.map((row) => (
            <tr key={`${field.label}-${row.join("|")}`}>
              {row.map((cell, cellIndex) => {
                const column = value.columns.at(cellIndex) ?? "字段";
                return (
                  <td
                    key={`${column}-${cell}`}
                    className="border-b border-[var(--app-border-soft)] px-2 py-1.5 align-top last:border-b-0"
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeInsightContent(props: { insight: WorkflowNodeInsight }) {
  const { insight } = props;

  return (
    <div className="mt-4 grid gap-4">
      {insight.summary ? (
        <p className="text-sm leading-6 text-[var(--app-text)]">
          {insight.summary}
        </p>
      ) : null}
      {insight.fields.map((field) => (
        <section key={field.label} className="grid gap-1.5">
          <h4 className="text-sm font-medium text-[var(--app-text-strong)]">
            {field.label}
          </h4>
          <InsightFieldValue field={field} />
          {field.citations?.length ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5">
              {field.citations.map((citation) =>
                citation.url ? (
                  <a
                    key={citation.referenceId}
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--app-accent-strong)] hover:underline"
                  >
                    {citation.label}
                  </a>
                ) : (
                  <span
                    key={citation.referenceId}
                    className="text-[var(--app-text-subtle)]"
                  >
                    {citation.label}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </section>
      ))}
      {insight.downstreamNote ? (
        <section className="border-t border-[var(--app-border-soft)] pt-3">
          <h4 className="text-sm font-medium text-[var(--app-text-strong)]">
            对下一步的影响
          </h4>
          <p className="mt-1.5 text-sm leading-6 text-[var(--app-text)]">
            {insight.downstreamNote}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function NodeTooltip(props: {
  node: WorkflowDiagramNode;
  state: WorkflowDiagramNodeRuntimeState;
  placement: "left" | "right";
  tooltipId: string;
  visible: boolean;
}) {
  const { node, placement, state, tooltipId, visible } = props;
  const status = state.status;
  const displayLabel = formatWorkflowDiagramNodeLabel(node.id, node.label);

  return (
    <div
      id={tooltipId}
      role="dialog"
      aria-label={`${displayLabel}详情`}
      className={cn(
        "pointer-events-auto absolute top-0 z-20 w-[min(460px,calc(100vw-2rem))] max-h-[min(70vh,620px)] overscroll-contain overflow-y-auto border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 text-left shadow-[var(--app-shadow-sm)]",
        visible ? "block" : "hidden",
        placement === "right" ? "left-full ml-3" : "right-full mr-3",
      )}
      data-node-inspector="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--app-text-strong)]">
            节点详情
          </div>
          <div className="mt-1 text-sm text-[var(--app-text)]">
            {displayLabel}
          </div>
        </div>
        <StatusPill
          label={statusLabelMap[status] ?? status}
          tone={statusToneMap[status] ?? "neutral"}
        />
      </div>
      <section className="mt-4 border-b border-[var(--app-border-soft)] pb-4">
        <h4 className="text-sm font-medium text-[var(--app-text-strong)]">
          本节点作用
        </h4>
        <p className="mt-1.5 text-sm leading-6 text-[var(--app-text-muted)]">
          {node.description}
        </p>
      </section>
      {state.latestProgress ? (
        <section className="mt-4 border-b border-[var(--app-border-soft)] pb-4">
          <h4 className="text-sm font-medium text-[var(--app-text-strong)]">
            当前进度
          </h4>
          <p className="mt-1.5 text-sm leading-6 text-[var(--app-text)]">
            {state.latestProgress.message}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">
            更新于 {formatDate(state.latestProgress.occurredAt)}
          </p>
        </section>
      ) : null}
      {state.insight ? <NodeInsightContent insight={state.insight} /> : null}
      {(status === "done" || status === "skipped") && !state.insight ? (
        <p className="mt-4 text-sm leading-6 text-[var(--app-text-muted)]">
          节点已完成，正在加载本次运行的节点洞察。
        </p>
      ) : null}
      <div className="mt-4 grid gap-x-4 gap-y-1.5 border-t border-[var(--app-border-soft)] pt-3 text-xs leading-5 text-[var(--app-text-subtle)] sm:grid-cols-2">
        <div>节点类型：{node.kind}</div>
        <div>执行次数：{state.attempt ?? "-"}</div>
        <div>耗时：{state.durationMs ?? "-"} ms</div>
        <div>开始时间：{formatDate(state.startedAt)}</div>
        <div>完成时间：{formatDate(state.completedAt)}</div>
        {state.errorCode || state.errorMessage ? (
          <div>错误信息：{state.errorCode ?? state.errorMessage}</div>
        ) : null}
      </div>
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
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = (nodeId: string) => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setActiveNodeId((current) =>
        current === nodeId ? pinnedNodeId : current,
      );
      closeTimerRef.current = null;
    }, 180);
  };

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
            const displayLabel = formatWorkflowDiagramNodeLabel(
              node.id,
              node.label,
            );
            const active =
              state.status === "active" ||
              state.status === "paused" ||
              runtime.currentNodeId === node.id;
            const hasRoomOnRight =
              node.x + node.width + 384 <= spec.layout.width;
            const tooltipPlacement =
              hasRoomOnRight || node.x < 384 ? "right" : "left";
            const tooltipId = `workflow-node-tooltip-${node.id}`;

            return (
              <fieldset
                key={node.id}
                className="absolute"
                aria-label={`${displayLabel} 节点详情`}
                onMouseEnter={() => {
                  cancelScheduledClose();
                  setActiveNodeId(node.id);
                }}
                onMouseLeave={() => scheduleClose(node.id)}
                onFocusCapture={() => setActiveNodeId(node.id)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setActiveNodeId((current) =>
                      current === node.id ? pinnedNodeId : current,
                    );
                  }
                }}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  minHeight: node.height,
                }}
              >
                <button
                  type="button"
                  aria-describedby={tooltipId}
                  aria-expanded={activeNodeId === node.id}
                  data-node-pinned={pinnedNodeId === node.id}
                  onClick={() => {
                    cancelScheduledClose();
                    setPinnedNodeId((current) =>
                      current === node.id ? null : node.id,
                    );
                    setActiveNodeId(node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setPinnedNodeId(null);
                      setActiveNodeId(null);
                      event.currentTarget.blur();
                    }
                  }}
                  className={cn(
                    "h-full min-h-[inherit] w-full border bg-[var(--app-surface)] px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]",
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
                  data-node-id={node.id}
                  data-node-status={state.status}
                >
                  <span className="block text-sm font-medium leading-5">
                    {displayLabel}
                  </span>
                </button>
                <NodeTooltip
                  node={node}
                  placement={tooltipPlacement}
                  state={state}
                  tooltipId={tooltipId}
                  visible={activeNodeId === node.id}
                />
              </fieldset>
            );
          })}
        </div>
      </div>
    </div>
  );
}
