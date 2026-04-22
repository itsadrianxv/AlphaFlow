"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";

import { EmptyState, Panel } from "~/app/_components/ui";
import { formatWorkflowNodeLabel } from "~/app/workflows/detail-labels";
import { ResearchOpsPanels } from "~/app/workflows/research-ops-panels";
import type { WorkflowDiagramRunDetail } from "~/app/workflows/workflow-diagram-runtime";
import { buildWorkflowDiagramRuntimeState } from "~/app/workflows/workflow-diagram-runtime";
import {
  getLatestWorkflowDiagramSpec,
  getWorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram-specs";
import { WorkflowStateDiagram } from "~/app/workflows/workflow-state-diagram";

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
      return "鎺掗槦涓?";
    case "RUNNING":
      return "杩涜涓?";
    case "PAUSED":
      return "宸叉殏鍋?";
    case "SUCCEEDED":
      return "宸插畬鎴?";
    case "FAILED":
      return "澶辫触";
    case "CANCELLED":
      return "宸插彇娑?";
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
          title="Agent 鐘舵€佸浘"
          description="当前详情页没有可用的 workflow run 数据。"
        >
          <EmptyState title="鏆傛棤 Agent 杩愯鏁版嵁" />
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
          title="Agent 鐘舵€佸浘"
          description="显示当前 workflow 的 Agent 拓扑、执行进度和已走过的路径。"
        >
          <WorkflowStateDiagram spec={spec} runtime={runtime} />
        </Panel>

        <Panel
          title="杩愯鎽樿"
          description="保留详情页内的通用运行状态摘要。"
        >
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
