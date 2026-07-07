"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  EmptyState,
  InlineNotice,
  SectionCard,
  StatusPill,
  WorkspaceShell,
  cn,
} from "~/app/_components/ui";
import type { WorkspaceHistoryItem } from "~/app/_components/workspace-shell";
import { api, type RouterOutputs } from "~/trpc/react";

type AgentRun = NonNullable<RouterOutputs["agentRuntime"]["getRun"]>;
type WorkflowStreamEvent = {
  runId: string;
  sequence: number;
  type: string;
  nodeKey?: string;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

const statusTone = {
  PENDING: "neutral",
  RUNNING: "info",
  PAUSED: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
} as const;

const statusLabel = {
  PENDING: "排队中",
  RUNNING: "运行中",
  PAUSED: "已暂停",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
} as const;

function getRunTitle(run: { query: string }) {
  return run.query.replace(/^Pi Agent - /, "");
}

function buildHistoryItems(
  runs: RouterOutputs["agentRuntime"]["listRuns"]["items"],
): WorkspaceHistoryItem[] {
  return runs.map((run) => ({
    id: run.id,
    title: getRunTitle(run),
    href: `/agent-runtime?runId=${run.id}`,
    activeMatchHref: `/agent-runtime?runId=${run.id}`,
  }));
}

function stringifyPreview(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readFinalReport(run?: AgentRun) {
  const artifact = [...(run?.artifacts ?? [])]
    .reverse()
    .find((item) => item.kind === "report" && item.payload);
  const payload =
    artifact?.payload && typeof artifact.payload === "object"
      ? (artifact.payload as Record<string, unknown>)
      : undefined;
  const artifactText =
    typeof payload?.text === "string" ? payload.text.trim() : "";

  if (artifactText) {
    return artifactText;
  }

  const result =
    run?.result && typeof run.result === "object"
      ? (run.result as Record<string, unknown>)
      : undefined;
  const finalOutput =
    result?.finalOutput && typeof result.finalOutput === "object"
      ? (result.finalOutput as Record<string, unknown>)
      : undefined;

  return typeof finalOutput?.text === "string" ? finalOutput.text.trim() : "";
}

function parseContext(raw: string) {
  if (!raw.trim()) {
    return undefined;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

function EventRow(props: { event: WorkflowStreamEvent | AgentRun["events"][number] }) {
  const { event } = props;
  const payload =
    "payload" in event && event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : {};
  const type =
    typeof payload.piEventType === "string"
      ? payload.piEventType
      : "eventType" in event
        ? event.eventType
        : event.type;
  const message =
    typeof payload.message === "string"
      ? payload.message
      : typeof event.payload === "object"
        ? stringifyPreview(payload.payload ?? payload).slice(0, 220)
        : "";
  const timestamp =
    "timestamp" in event
      ? event.timestamp
      : event.occurredAt instanceof Date
        ? event.occurredAt.toLocaleString("zh-CN")
        : String(event.occurredAt);

  return (
    <div className="grid gap-2 border-b border-[var(--app-border-soft)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="app-data text-xs text-[var(--app-text-strong)]">
          {type}
        </span>
        <span className="text-xs text-[var(--app-text-subtle)]">
          {timestamp}
        </span>
      </div>
      {message ? (
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          {message}
        </div>
      ) : null}
    </div>
  );
}

export function AgentRuntimeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRunId = searchParams.get("runId") ?? "";
  const utils = api.useUtils();
  const [skillId, setSkillId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [contextJson, setContextJson] = useState("");
  const [contextError, setContextError] = useState("");
  const [liveEvents, setLiveEvents] = useState<WorkflowStreamEvent[]>([]);

  const skillsQuery = api.agentRuntime.listSkills.useQuery();
  const runsQuery = api.agentRuntime.listRuns.useQuery({ limit: 20 });
  const runQuery = api.agentRuntime.getRun.useQuery(
    { runId: selectedRunId },
    {
      enabled: Boolean(selectedRunId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "RUNNING" || status === "PENDING" ? 4000 : false;
      },
    },
  );

  useEffect(() => {
    const firstSkill = skillsQuery.data?.items[0]?.id;
    if (!skillId && firstSkill) {
      setSkillId(firstSkill);
    }
  }, [skillId, skillsQuery.data?.items]);

  useEffect(() => {
    if (!selectedRunId) {
      setLiveEvents([]);
      return;
    }

    const eventSource = new EventSource(
      `/api/workflows/runs/${selectedRunId}/events`,
    );
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WorkflowStreamEvent;
        setLiveEvents((current) => {
          if (current.some((item) => item.sequence === parsed.sequence)) {
            return current;
          }
          return [...current, parsed].slice(-80);
        });

        if (
          parsed.type === "RUN_SUCCEEDED" ||
          parsed.type === "RUN_FAILED" ||
          parsed.type === "RUN_CANCELLED"
        ) {
          void utils.agentRuntime.getRun.invalidate({ runId: selectedRunId });
          void utils.agentRuntime.listRuns.invalidate({ limit: 20 });
        }
      } catch {
        // Ignore malformed event payloads from intermediate proxies.
      }
    };

    return () => {
      eventSource.close();
    };
  }, [selectedRunId, utils.agentRuntime.getRun, utils.agentRuntime.listRuns]);

  const historyItems = useMemo(
    () => buildHistoryItems(runsQuery.data?.items ?? []),
    [runsQuery.data?.items],
  );
  const selectedRun = runQuery.data;
  const finalReport = readFinalReport(selectedRun);
  const mergedEvents = useMemo(() => {
    const bySequence = new Map<number, WorkflowStreamEvent | AgentRun["events"][number]>();
    for (const event of selectedRun?.events ?? []) {
      bySequence.set(event.sequence, event);
    }
    for (const event of liveEvents) {
      bySequence.set(event.sequence, event);
    }
    return [...bySequence.values()].sort((left, right) => {
      const leftSequence = "sequence" in left ? left.sequence : 0;
      const rightSequence = "sequence" in right ? right.sequence : 0;
      return leftSequence - rightSequence;
    });
  }, [liveEvents, selectedRun?.events]);

  const startMutation = api.agentRuntime.startRun.useMutation({
    onSuccess: async (result) => {
      await utils.agentRuntime.listRuns.invalidate({ limit: 20 });
      router.push(`/agent-runtime?runId=${result.runId}`);
    },
  });
  const cancelMutation = api.agentRuntime.cancelRun.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.agentRuntime.getRun.invalidate({ runId: selectedRunId }),
        utils.agentRuntime.listRuns.invalidate({ limit: 20 }),
      ]);
    },
  });

  const handleStart = async () => {
    setContextError("");
    let context: Record<string, unknown> | undefined;

    try {
      context = parseContext(contextJson);
    } catch {
      setContextError("上下文 JSON 不是合法对象。");
      return;
    }

    await startMutation.mutateAsync({
      skillId,
      prompt,
      title: title.trim() || undefined,
      context,
    });
  };

  return (
    <WorkspaceShell
      section="agentRuntime"
      title="Pi Agent"
      historyItems={historyItems}
      historyHref="/agent-runtime"
      historyLoading={runsQuery.isLoading}
      historyEmptyText="还没有 Pi Agent 运行"
      activeHistoryId={selectedRunId}
      actions={
        <>
          <Link href="/workflows" className="app-button">
            行业研究
          </Link>
          <Link href="/company-research" className="app-button">
            公司判断
          </Link>
        </>
      }
      contentWidth="wide"
      titleSize="compact"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <SectionCard
          title="新建运行"
          actions={
            <button
              type="button"
              className="app-button app-button-primary"
              disabled={startMutation.isPending || !skillId || !prompt.trim()}
              onClick={handleStart}
            >
              {startMutation.isPending ? "正在创建" : "启动"}
            </button>
          }
        >
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              Skill
              <select
                value={skillId}
                onChange={(event) => setSkillId(event.target.value)}
              >
                {(skillsQuery.data?.items ?? []).map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              标题
              <input
                className="app-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="可选"
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              任务
              <textarea
                className="app-textarea min-h-[180px]"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：梳理 AI 眼镜供应链未来 6 个月需要验证的核心指标。"
              />
            </label>

            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              上下文 JSON
              <textarea
                className="app-textarea min-h-[120px] font-mono text-sm"
                value={contextJson}
                onChange={(event) => setContextJson(event.target.value)}
                placeholder='{"stockCodes":["600519"],"freshnessWindowDays":180}'
              />
            </label>

            {contextError ? (
              <InlineNotice tone="danger" description={contextError} />
            ) : null}
            {startMutation.error ? (
              <InlineNotice
                tone="danger"
                description={startMutation.error.message}
              />
            ) : null}
            {skillsQuery.error ? (
              <InlineNotice
                tone="danger"
                description={skillsQuery.error.message}
              />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title={selectedRun ? getRunTitle(selectedRun) : "运行详情"}
          actions={
            selectedRun &&
            (selectedRun.status === "RUNNING" ||
              selectedRun.status === "PENDING") ? (
              <button
                type="button"
                className="app-button app-button-danger"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ runId: selectedRun.id })}
              >
                取消
              </button>
            ) : null
          }
        >
          {selectedRun ? (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill
                  tone={statusTone[selectedRun.status]}
                  label={statusLabel[selectedRun.status]}
                />
                <span className="text-sm text-[var(--app-text-muted)]">
                  进度 {selectedRun.progressPercent}%
                </span>
                <span className="text-sm text-[var(--app-text-muted)]">
                  {selectedRun.currentNodeKey ?? "等待节点"}
                </span>
              </div>

              {selectedRun.errorMessage ? (
                <InlineNotice
                  tone="danger"
                  title={selectedRun.errorCode ?? "运行失败"}
                  description={selectedRun.errorMessage}
                />
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    事件
                  </div>
                  <div className="mt-3 max-h-[360px] overflow-y-auto pr-2">
                    {mergedEvents.length > 0 ? (
                      mergedEvents.map((event) => (
                        <EventRow key={event.sequence} event={event} />
                      ))
                    ) : (
                      <div className="text-sm text-[var(--app-text-subtle)]">
                        暂无事件
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    工具调用
                  </div>
                  <div className="mt-3 grid gap-3">
                    {selectedRun.toolCalls.length > 0 ? (
                      selectedRun.toolCalls.map((toolCall) => (
                        <div
                          key={toolCall.id}
                          className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-sm text-[var(--app-text-strong)]">
                              {toolCall.toolName}
                            </span>
                            <StatusPill
                              tone={
                                toolCall.status === "succeeded"
                                  ? "success"
                                  : toolCall.status === "failed"
                                    ? "danger"
                                    : "info"
                              }
                              label={toolCall.status}
                            />
                          </div>
                          <pre className="mt-3 max-h-[160px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--app-text-muted)]">
                            {stringifyPreview(
                              toolCall.outputSummary ??
                                toolCall.inputSummary ??
                                {},
                            )}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[var(--app-text-subtle)]">
                        暂无工具调用
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    最终产物
                  </div>
                  <span className="text-xs text-[var(--app-text-subtle)]">
                    {selectedRun.artifacts.length} 个 artifact
                  </span>
                </div>
                {finalReport ? (
                  <MarkdownContent content={finalReport} />
                ) : (
                  <div className="text-sm text-[var(--app-text-subtle)]">
                    运行结束后显示报告。
                  </div>
                )}
              </div>
            </div>
          ) : selectedRunId && runQuery.isLoading ? (
            <div className="text-sm text-[var(--app-text-muted)]">加载中</div>
          ) : (
            <EmptyState title="选择一次运行" />
          )}
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
