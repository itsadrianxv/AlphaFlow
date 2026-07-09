"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";

import { EmptyState, Panel } from "~/app/_components/ui";
import { formatWorkflowDiagramNodeLabel } from "~/app/workflows/detail-labels";
import { ResearchOpsPanels } from "~/app/workflows/research-ops-panels";
import type { WorkflowDiagramRunDetail } from "~/app/workflows/workflow-diagram-runtime";
import { buildWorkflowDiagramRuntimeState } from "~/app/workflows/workflow-diagram-runtime";
import {
  getLatestWorkflowDiagramSpec,
  getWorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram-specs";
import { WorkflowStateDiagram } from "~/app/workflows/workflow-state-diagram";

function hasVisibleResearchOps(
  result: unknown,
  options: {
    showResearchPlan: boolean;
    showReflection: boolean;
  },
) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  const candidate = result as Record<string, unknown>;
  return (
    (options.showResearchPlan && Array.isArray(candidate.researchPlan)) ||
    Array.isArray(candidate.replanRecords) ||
    (options.showReflection &&
      typeof candidate.reflection === "object" &&
      candidate.reflection !== null)
  );
}

function countFinishedNodes(run: WorkflowDiagramRunDetail, status: string) {
  return run.nodes.filter((node) => node.status === status).length;
}

function buildSpec(run: WorkflowDiagramRunDetail) {
  const version = run.template.version;
  if (typeof version === "number") {
    return getWorkflowDiagramSpec(run.template.code, version);
  }

  return getLatestWorkflowDiagramSpec(run.template.code);
}

function formatRunStatus(status: string) {
  switch (status) {
    case "PENDING":
      return "排队中";
    case "RUNNING":
      return "进行中";
    case "PAUSED":
      return "已暂停";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    case "CANCELLED":
      return "已取消";
    default:
      return status;
  }
}

export function WorkflowAgentStep(props: {
  run: WorkflowDiagramRunDetail | null;
  className?: string;
  showResearchPlan?: boolean;
  showReflection?: boolean;
}) {
  const {
    run,
    className,
    showResearchPlan = true,
    showReflection = true,
  } = props;

  if (!run) {
    return (
      <div className={className}>
        <Panel
          title="Agent 状态图"
          description="当前详情页没有可用的工作流运行数据。"
        >
          <EmptyState title="暂无 Agent 运行数据" />
        </Panel>
      </div>
    );
  }

  const spec = buildSpec(run);
  const runtime = buildWorkflowDiagramRuntimeState({
    spec,
    run,
  });

  const currentNodeLabel = run.currentNodeKey
    ? formatWorkflowDiagramNodeLabel(run.currentNodeKey)
    : "-";

  return (
    <div className={className}>
      <div className="grid gap-6">
        <Panel title="Agent 状态图">
          <WorkflowStateDiagram spec={spec} runtime={runtime} />
        </Panel>

        <Panel title="运行摘要">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">状态</div>
              <div className="mt-2 text-lg text-[var(--app-text)]">
                {formatRunStatus(run.status)}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">进度</div>
              <div className="mt-2 text-lg text-[var(--app-text)]">
                {run.progressPercent}%
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                当前节点
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--app-text)]">
                {currentNodeLabel}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                完成 / 失败
              </div>
              <div className="mt-2 text-lg text-[var(--app-text)]">
                {countFinishedNodes(run, "SUCCEEDED")} /{" "}
                {countFinishedNodes(run, "FAILED")}
              </div>
            </div>
          </div>
        </Panel>

        {hasVisibleResearchOps(run.result, {
          showResearchPlan,
          showReflection,
        }) ? (
          <ResearchOpsPanels
            result={run.result}
            showResearchPlan={showResearchPlan}
            showReflection={showReflection}
          />
        ) : null}
      </div>
    </div>
  );
}
