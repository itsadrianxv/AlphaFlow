"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";
import { formatWorkflowNodeLabel } from "~/modules/research/ui/industry/detail-labels";
import { ResearchOpsPanels } from "~/modules/research/ui/industry/research-ops-panels";
import type { WorkflowDiagramRunDetail } from "~/modules/research/ui/industry/workflow-diagram-runtime";
import { buildWorkflowDiagramRuntimeState } from "~/modules/research/ui/industry/workflow-diagram-runtime";
import {
  getLatestWorkflowDiagramSpec,
  getWorkflowDiagramSpec,
} from "~/modules/research/ui/industry/workflow-diagram-specs";
import { WorkflowStateDiagram } from "~/modules/research/ui/industry/workflow-state-diagram";
import { EmptyState, Panel } from "~/shared/ui/primitives/ui";

function hasResearchOps(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  const candidate = result as Record<string, unknown>;
  return (
    Array.isArray(candidate.researchPlan) ||
    Array.isArray(candidate.replanRecords) ||
    (typeof candidate.reflection === "object" && candidate.reflection !== null)
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
}) {
  const { run, className } = props;

  if (!run) {
    return (
      <div className={className}>
        <Panel
          title="Agent 状态图"
          description="当前详情页没有可用的 workflow run 数据。"
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
    ? formatWorkflowNodeLabel(run.currentNodeKey)
    : "-";

  return (
    <div className={className}>
      <div className="grid gap-6">
        <Panel
          title="Agent 状态图"
          description="显示当前 workflow 的 Agent 拓扑、执行进度和已走过的路径。"
        >
          <WorkflowStateDiagram spec={spec} runtime={runtime} />
        </Panel>

        <Panel title="运行摘要" description="保留详情页内的通用运行状态摘要。">
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

        {hasResearchOps(run.result) ? (
          <ResearchOpsPanels result={run.result} />
        ) : null}
      </div>
    </div>
  );
}
