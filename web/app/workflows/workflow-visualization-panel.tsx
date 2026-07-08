"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useEffect } from "react";
import {
  EmptyState,
  InlineNotice,
  LoadingSkeleton,
  Panel,
} from "~/app/_components/ui";
import { buildWorkflowDiagramRuntimeState } from "~/app/workflows/workflow-diagram-runtime";
import {
  getLatestWorkflowDiagramSpec,
  getWorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram-specs";
import { WorkflowStateDiagram } from "~/app/workflows/workflow-state-diagram";
import { api } from "~/trpc/react";

type WorkflowVisualizationPanelProps = {
  runId?: string;
  templateCode?: string;
  templateVersion?: number;
  title?: string;
  description?: string;
  detailHref?: string;
};

function shouldStream(status?: string) {
  return status === "PENDING" || status === "RUNNING" || status === "PAUSED";
}

export function WorkflowVisualizationPanel(
  props: WorkflowVisualizationPanelProps,
) {
  const {
    runId,
    templateCode,
    templateVersion,
    title = "流程状态图",
    description = "显示完整 Agent 拓扑、当前执行节点和本次运行已经走过的路径。",
    detailHref,
  } = props;

  const utils = api.useUtils?.();
  const runQuery = api.workflow.getRun.useQuery(
    { runId: runId ?? "" },
    {
      enabled: Boolean(runId),
      refetchOnWindowFocus: false,
    },
  );

  const run = runQuery.data ?? null;
  const resolvedTemplateCode = run?.template.code ?? templateCode;
  const resolvedTemplateVersion = run?.template.version ?? templateVersion;
  const spec =
    resolvedTemplateCode && typeof resolvedTemplateVersion === "number"
      ? getWorkflowDiagramSpec(resolvedTemplateCode, resolvedTemplateVersion)
      : resolvedTemplateCode
        ? getLatestWorkflowDiagramSpec(resolvedTemplateCode)
        : null;
  const runtime = run
    ? buildWorkflowDiagramRuntimeState({ spec, run })
    : spec
      ? buildWorkflowDiagramRuntimeState({
          spec,
          run: {
            id: "static-preview",
            query: "",
            status: "PENDING",
            progressPercent: 0,
            currentNodeKey: null,
            input: {},
            errorCode: null,
            errorMessage: null,
            result: {},
            template: {
              code: spec.templateCode,
              version: spec.templateVersion,
            },
            createdAt: new Date(0),
            startedAt: null,
            completedAt: null,
            nodes: [],
            events: [],
          },
        })
      : null;

  useEffect(() => {
    if (!runId || !run || !shouldStream(run.status)) {
      return;
    }

    const eventSource = new EventSource(`/api/workflows/runs/${runId}/events`);
    eventSource.onmessage = () => {
      void utils?.workflow?.getRun?.invalidate?.({ runId });
    };
    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, run, utils]);

  return (
    <Panel
      title={title}
      description={description}
      actions={
        detailHref ? (
          <Link href={detailHref} className="app-button">
            查看运行详情
          </Link>
        ) : undefined
      }
    >
      {runQuery.isLoading ? <LoadingSkeleton rows={3} /> : null}
      {runQuery.error ? (
        <InlineNotice
          tone="danger"
          title="状态图加载失败"
          description={runQuery.error.message}
        />
      ) : null}
      {!runQuery.isLoading && !runQuery.error && !runtime ? (
        <EmptyState
          title="暂无状态图数据"
          description="提供工作流运行记录或模板编号后，这里会显示状态图。"
        />
      ) : null}
      {runtime ? <WorkflowStateDiagram spec={spec} runtime={runtime} /> : null}
    </Panel>
  );
}
