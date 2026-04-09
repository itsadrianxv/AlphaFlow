"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { statusTone } from "~/app/_components/status-tone";
import {
  EmptyState,
  KpiCard,
  Panel,
  ProgressBar,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { ResearchOpsPanels } from "~/app/workflows/research-ops-panels";
import { getTemplateLabel } from "~/app/workflows/research-view-models";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  type CompanyResearchResultDto,
  type QuickResearchResultDto,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import { api } from "~/trpc/react";

type RunDetailClientProps = {
  runId: string;
};

type StreamEvent = {
  runId: string;
  sequence: number;
  type: string;
  nodeKey?: string;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function buildResultHighlights(
  result: unknown,
): Array<{ key: string; value: string }> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  return Object.entries(result as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => {
      const text = formatUnknownValue(value);
      return {
        key,
        value: text.length > 180 ? `${text.slice(0, 180)}...` : text,
      };
    });
}

function isCompanyResearchResult(
  value: unknown,
): value is CompanyResearchResultDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    !!candidate.brief &&
    !!candidate.verdict &&
    Array.isArray(candidate.conceptInsights) &&
    Array.isArray(candidate.findings) &&
    Array.isArray(candidate.evidence)
  );
}

function getClarificationPayloadFromResult(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = (value as QuickResearchResultDto).clarificationRequest;
  return isRecord(candidate) && candidate.needClarification === true
    ? candidate
    : null;
}

function getBackLink(templateCode?: string) {
  return templateCode === COMPANY_RESEARCH_TEMPLATE_CODE
    ? "/company-research"
    : "/workflows";
}

function getSection(templateCode?: string) {
  return templateCode === COMPANY_RESEARCH_TEMPLATE_CODE
    ? "companyResearch"
    : "workflows";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listParam(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join("\n") : undefined;
}

function buildContinuationHref(params: {
  templateCode?: string;
  input?: unknown;
  clarificationPayload?: Record<string, unknown>;
}) {
  if (!isRecord(params.input)) {
    return null;
  }

  const search = new URLSearchParams();
  const suggestedInputPatch = isRecord(
    params.clarificationPayload?.suggestedInputPatch,
  )
    ? params.clarificationPayload.suggestedInputPatch
    : {};
  const mergedInput = {
    ...params.input,
    ...suggestedInputPatch,
  } as Record<string, unknown>;

  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    if (typeof mergedInput.companyName === "string") {
      search.set("companyName", mergedInput.companyName);
    }
    if (typeof mergedInput.stockCode === "string") {
      search.set("stockCode", mergedInput.stockCode);
    }
    if (typeof mergedInput.officialWebsite === "string") {
      search.set("officialWebsite", mergedInput.officialWebsite);
    }
    const focusConcepts = listParam(mergedInput.focusConcepts);
    if (focusConcepts) {
      search.set("focusConcepts", focusConcepts);
    }
    if (typeof mergedInput.keyQuestion === "string") {
      search.set("keyQuestion", mergedInput.keyQuestion);
    }
    const supplementalUrls = listParam(mergedInput.supplementalUrls);
    if (supplementalUrls) {
      search.set("supplementalUrls", supplementalUrls);
    }
  } else {
    if (typeof mergedInput.query === "string") {
      search.set("query", mergedInput.query);
    }
  }

  const researchPreferences = isRecord(mergedInput.researchPreferences)
    ? mergedInput.researchPreferences
    : {};
  if (typeof researchPreferences.researchGoal === "string") {
    search.set("researchGoal", researchPreferences.researchGoal);
  }
  const mustAnswerQuestions = listParam(
    researchPreferences.mustAnswerQuestions,
  );
  if (mustAnswerQuestions) {
    search.set("mustAnswerQuestions", mustAnswerQuestions);
  }
  const forbiddenEvidenceTypes = listParam(
    researchPreferences.forbiddenEvidenceTypes,
  );
  if (forbiddenEvidenceTypes) {
    search.set("forbiddenEvidenceTypes", forbiddenEvidenceTypes);
  }
  const preferredSources = listParam(researchPreferences.preferredSources);
  if (preferredSources) {
    search.set("preferredSources", preferredSources);
  }
  if (typeof researchPreferences.freshnessWindowDays === "number") {
    search.set(
      "freshnessWindowDays",
      String(researchPreferences.freshnessWindowDays),
    );
  }

  const basePath =
    params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE
      ? "/company-research"
      : "/workflows";
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const statusLabels: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

statusLabels.PAUSED = "已暂停";

const eventTypeLabelMap: Record<string, string> = {
  RUN_STARTED: "任务开始",
  RUN_PAUSED: "任务暂停",
  RUN_RESUMED: "任务恢复",
  NODE_STARTED: "节点开始",
  NODE_PROGRESS: "节点进度",
  NODE_SUCCEEDED: "节点完成",
  NODE_FAILED: "节点失败",
  RUN_SUCCEEDED: "任务完成",
  RUN_FAILED: "任务失败",
  RUN_CANCELLED: "任务取消",
};

export function RunDetailClient({ runId }: RunDetailClientProps) {
  const utils = api.useUtils();
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const runQuery = api.workflow.getRun.useQuery(
    { runId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;

        if (
          status === "SUCCEEDED" ||
          status === "FAILED" ||
          status === "CANCELLED"
        ) {
          return false;
        }

        return 10_000;
      },
    },
  );

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.getRun.invalidate({ runId });
    },
  });
  const approveMutation = api.workflow.approveScreeningInsights.useMutation({
    onSuccess: async () => {
      await utils.workflow.getRun.invalidate({ runId });
    },
  });
  type RunEventItem = NonNullable<typeof runQuery.data>["events"][number];
  type RunNodeItem = NonNullable<typeof runQuery.data>["nodes"][number];

  useEffect(() => {
    const eventSource = new EventSource(`/api/workflows/runs/${runId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        setStreamEvents((previous) => {
          if (previous.some((item) => item.sequence === parsed.sequence)) {
            return previous;
          }

          return [...previous, parsed].sort(
            (left, right) => left.sequence - right.sequence,
          );
        });

        void utils.workflow.getRun.invalidate({ runId });

        if (
          parsed.type === "RUN_SUCCEEDED" ||
          parsed.type === "RUN_FAILED" ||
          parsed.type === "RUN_CANCELLED"
        ) {
          eventSource.close();
        }
      } catch {
        setStreamError("实时事件解析失败");
      }
    };

    eventSource.onerror = () => {
      setStreamError("实时连接中断，页面将继续轮询刷新。");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, utils.workflow.getRun]);

  const timeline = useMemo(() => {
    const dbEvents =
      runQuery.data?.events.map((event: RunEventItem) => ({
        runId,
        sequence: event.sequence,
        type: event.eventType,
        nodeKey:
          typeof (event.payload as Record<string, unknown> | null)?.nodeKey ===
          "string"
            ? ((event.payload as Record<string, unknown>).nodeKey as string)
            : undefined,
        progressPercent: runQuery.data?.progressPercent ?? 0,
        timestamp: event.occurredAt.toISOString(),
        payload: (event.payload ?? {}) as Record<string, unknown>,
      })) ?? [];

    const merged = [...dbEvents, ...streamEvents];
    const uniqueBySequence = new Map<number, StreamEvent>();

    for (const event of merged) {
      uniqueBySequence.set(event.sequence, event);
    }

    return [...uniqueBySequence.values()].sort(
      (left, right) => right.sequence - left.sequence,
    );
  }, [
    runId,
    runQuery.data?.events,
    runQuery.data?.progressPercent,
    streamEvents,
  ]);

  const run = runQuery.data;
  const canApprove =
    run?.template.code === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE &&
    run.status === "PAUSED";
  const companyResult = isCompanyResearchResult(run?.result)
    ? run.result
    : null;
  const companyReferenceMap = useMemo(
    () =>
      new Map(
        (companyResult?.references ?? []).map(
          (item) => [item.id, item] as const,
        ),
      ),
    [companyResult],
  );
  const resultHighlights = useMemo(
    () => buildResultHighlights(run?.result),
    [run?.result],
  );
  const backLink = getBackLink(run?.template.code);
  const section = getSection(run?.template.code);
  const latestPauseEvent = useMemo(
    () =>
      [...(run?.events ?? [])]
        .reverse()
        .find((event: RunEventItem) => event.eventType === "RUN_PAUSED"),
    [run?.events],
  );
  const pausedClarificationPayload =
    latestPauseEvent &&
    isRecord(latestPauseEvent.payload) &&
    latestPauseEvent.payload.reason === "clarification_required"
      ? latestPauseEvent.payload
      : null;
  const resultClarificationPayload = useMemo(
    () => getClarificationPayloadFromResult(run?.result),
    [run?.result],
  );
  const clarificationPayload =
    pausedClarificationPayload ?? resultClarificationPayload;
  const clarificationIsPaused = pausedClarificationPayload !== null;
  const clarificationTitle = clarificationIsPaused ? "待补充信息" : "范围提醒";
  const clarificationDescription = clarificationIsPaused
    ? "本次研究在范围澄清阶段暂停，补充缺失信息后可直接重新发起同类任务。"
    : "本次研究已继续完成，但输入范围仍偏宽；补充关键信息后重新发起可以获得更聚焦的结果。";
  const clarificationCtaLabel = clarificationIsPaused
    ? "进入补充表单"
    : "补充后重新发起";
  const continuationHref = buildContinuationHref({
    templateCode: run?.template.code,
    input: run?.input,
    clarificationPayload: clarificationPayload ?? undefined,
  });

  return (
    <WorkspaceShell
      section={section}
      eyebrow="研究运行详情"
      title="研究任务详情"
      description="以运行视角查看状态、进度、节点、时间线和结果摘要。对进行中的任务，页面会自动接收事件并刷新。"
      actions={
        <>
          <Link href={backLink} className="app-button">
            返回任务列表
          </Link>
          {clarificationPayload && continuationHref ? (
            <Link
              href={continuationHref}
              className="app-button app-button-primary"
            >
              补充信息后重新发起
            </Link>
          ) : null}
          {canApprove ? (
            <button
              type="button"
              onClick={() => approveMutation.mutate({ runId })}
              disabled={approveMutation.isPending}
              className="app-button app-button-primary"
            >
              {approveMutation.isPending ? "恢复中..." : "审批并继续"}
            </button>
          ) : null}
          {run &&
          (run.status === "RUNNING" ||
            run.status === "PENDING" ||
            run.status === "PAUSED") ? (
            <button
              type="button"
              onClick={() => cancelMutation.mutate({ runId })}
              className="app-button app-button-danger"
            >
              取消任务
            </button>
          ) : null}
        </>
      }
      summary={
        <>
          <KpiCard
            label="状态"
            value={run ? (statusLabels[run.status] ?? run.status) : "加载中"}
            hint="当前运行状态"
            tone={statusTone(run?.status)}
          />
          <KpiCard
            label="进度"
            value={run ? `${run.progressPercent}%` : "-"}
            hint="按节点事件自动刷新"
            tone={statusTone(run?.status)}
          />
          <KpiCard
            label="当前阶段"
            value={run?.currentNodeKey ?? "准备中"}
            hint="显示当前执行节点"
            tone="info"
          />
          <KpiCard
            label="发起时间"
            value={run ? formatDate(run.createdAt) : "-"}
            hint="用于回溯本轮研究上下文"
            tone="neutral"
          />
        </>
      }
    >
      {!run ? (
        <Panel>
          <EmptyState
            title={runQuery.isLoading ? "正在加载任务详情" : "未找到该任务"}
            description={
              runQuery.isLoading
                ? "任务数据获取完成后，这里会出现运行状态与结果面板。"
                : (runQuery.error?.message ??
                  "该任务可能不存在，或当前账号无权访问。")
            }
          />
        </Panel>
      ) : (
        <>
          <Panel
            title="研究主题"
            description="题目、进度条和错误信息统一放在顶层，便于先判断是否需要继续等待。"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-start">
              <div>
                <p className="text-base leading-7 text-[var(--app-text)]">
                  {run.query}
                </p>
                <ProgressBar
                  value={run.progressPercent}
                  tone={statusTone(run.status)}
                  className="mt-4"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={statusLabels[run.status] ?? run.status}
                    tone={statusTone(run.status)}
                  />
                  <StatusPill
                    label={getTemplateLabel(run.template.code)}
                    tone={
                      run.template.code === COMPANY_RESEARCH_TEMPLATE_CODE
                        ? "info"
                        : "neutral"
                    }
                  />
                  <span className="app-data text-xs text-[var(--app-text-soft)]">
                    {run.progressPercent}%
                  </span>
                  <span className="text-xs text-[var(--app-text-soft)]">
                    创建于 {formatDate(run.createdAt)}
                  </span>
                </div>
                {run.errorMessage ? (
                  <div className="mt-4 rounded-[10px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                    {run.errorCode ? `${run.errorCode}: ` : ""}
                    {run.errorMessage}
                  </div>
                ) : null}
                {canApprove ? (
                  <div className="mt-4 rounded-[10px] border border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] px-4 py-3 text-sm text-[var(--app-warning)]">
                    这条筛选洞察流程需要人工复核后才能继续执行。
                  </div>
                ) : null}
                {approveMutation.error ? (
                  <div className="mt-4 rounded-[10px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                    {approveMutation.error.message}
                  </div>
                ) : null}
              </div>

              <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-4 text-sm text-[var(--app-text-muted)]">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                  完成时间
                </p>
                <p className="app-data mt-3 text-[15px] text-[var(--app-text)]">
                  {formatDate(run.completedAt)}
                </p>
                <p className="mt-4 text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                  任务 ID
                </p>
                <p className="app-data mt-3 break-all text-[11px] text-[var(--app-text-soft)]">
                  {runId}
                </p>
              </div>
            </div>
          </Panel>

          {clarificationPayload && clarificationIsPaused ? (
            <Panel
              title="待补充信息"
              description="本次研究在范围澄清阶段暂停，补充缺失信息后可直接重新发起同类任务。"
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                  <p className="text-sm leading-7 text-[var(--app-text)]">
                    {typeof clarificationPayload.question === "string"
                      ? clarificationPayload.question
                      : "请补充研究范围后再重新发起任务。"}
                  </p>
                  {Array.isArray(clarificationPayload.missingScopeFields) &&
                  clarificationPayload.missingScopeFields.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {clarificationPayload.missingScopeFields.map((field) => (
                        <StatusPill
                          key={String(field)}
                          label={String(field)}
                          tone="warning"
                        />
                      ))}
                    </div>
                  ) : null}
                  {clarificationPayload.suggestedInputPatch ? (
                    <pre className="mt-4 overflow-x-auto rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel)] p-3 text-xs text-[var(--app-text-soft)]">
                      {JSON.stringify(
                        clarificationPayload.suggestedInputPatch,
                        null,
                        2,
                      )}
                    </pre>
                  ) : null}
                </div>
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4 text-sm text-[var(--app-text-muted)]">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                    下一步
                  </p>
                  <p className="mt-3 leading-6">
                    补充关键变量后，系统会保留原始输入，并自动预填建议字段。
                  </p>
                  {continuationHref ? (
                    <Link
                      href={continuationHref}
                      className="app-button app-button-primary mt-4 inline-flex"
                    >
                      进入补充表单
                    </Link>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : null}
          {clarificationPayload && !clarificationIsPaused ? (
            <Panel
              title={clarificationTitle}
              description={clarificationDescription}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="rounded-[12px] border border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] p-4">
                  <p className="text-sm leading-7 text-[var(--app-text)]">
                    {typeof clarificationPayload.question === "string"
                      ? clarificationPayload.question
                      : "当前研究已完成，但建议补充范围后重新发起，以获得更聚焦的结论。"}
                  </p>
                  {typeof clarificationPayload.verification === "string" &&
                  clarificationPayload.verification.length > 0 ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                      建议范围: {clarificationPayload.verification}
                    </p>
                  ) : null}
                  {Array.isArray(clarificationPayload.missingScopeFields) &&
                  clarificationPayload.missingScopeFields.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {clarificationPayload.missingScopeFields.map((field) => (
                        <StatusPill
                          key={String(field)}
                          label={String(field)}
                          tone="warning"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4 text-sm text-[var(--app-text-muted)]">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                    下一步
                  </p>
                  <p className="mt-3 leading-6">
                    补充范围后重新发起，系统会保留原始输入，并自动预填建议字段。
                  </p>
                  {continuationHref ? (
                    <Link
                      href={continuationHref}
                      className="app-button app-button-primary mt-4 inline-flex"
                    >
                      {clarificationCtaLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : null}

          {companyResult ? (
            <>
              <Panel
                title="投资判断"
                description="先看公司研究的最终立场，再决定是否继续下钻问题与证据。"
              >
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                      结论
                    </p>
                    <p className="app-display mt-3 text-2xl text-[var(--app-text)]">
                      {companyResult.verdict.stance}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {companyResult.brief.focusConcepts.map((concept) => (
                        <StatusPill key={concept} label={concept} tone="info" />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                    <p className="text-sm leading-7 text-[var(--app-text)]">
                      {companyResult.verdict.summary}
                    </p>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                          看多要点
                        </p>
                        <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                          {companyResult.verdict.bullPoints.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                          风险要点
                        </p>
                        <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                          {companyResult.verdict.bearPoints.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                          后续核验
                        </p>
                        <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                          {companyResult.verdict.nextChecks.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>

              {(companyResult.researchPlan?.length ||
                companyResult.researchNotes?.length ||
                companyResult.compressedFindings ||
                companyResult.gapAnalysis) && (
                <Panel
                  title="研究编排"
                  description="这里汇总新的研究工作流规划、笔记、压缩结论和缺口判断。"
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                        研究简报
                      </p>
                      <pre className="mt-3 overflow-x-auto text-xs leading-6 text-[var(--app-text-soft)]">
                        {JSON.stringify(
                          {
                            brief: companyResult.brief,
                            runtime: companyResult.runtimeConfigSummary ?? null,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </article>
                    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                        计划单元
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                        {(companyResult.researchPlan ?? []).length === 0 ? (
                          <p>暂无研究单元信息</p>
                        ) : (
                          companyResult.researchPlan?.map((unit) => (
                            <div
                              key={unit.id}
                              className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[13px] text-[var(--app-text)]">
                                  {unit.title}
                                </p>
                                <StatusPill
                                  label={unit.capability}
                                  tone="info"
                                />
                              </div>
                              <p className="mt-2 text-xs leading-5">
                                {unit.objective}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                        压缩结论
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                        <p className="text-[var(--app-text)]">
                          {companyResult.compressedFindings?.summary ??
                            "暂无压缩结论"}
                        </p>
                        {(
                          companyResult.compressedFindings?.highlights ?? []
                        ).map((item) => (
                          <p key={item}>- {item}</p>
                        ))}
                      </div>
                    </article>
                    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                        缺口分析
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-[var(--app-text-muted)]">
                        <p className="text-[var(--app-text)]">
                          {companyResult.gapAnalysis?.summary ?? "暂无缺口评估"}
                        </p>
                        {(companyResult.gapAnalysis?.missingAreas ?? []).map(
                          (item) => (
                            <p key={item}>- {item}</p>
                          ),
                        )}
                      </div>
                    </article>
                  </div>
                  {(companyResult.researchNotes ?? []).length > 0 ? (
                    <div className="mt-4 grid gap-3">
                      {(companyResult.researchNotes ?? [])
                        .slice(0, 6)
                        .map((note) => (
                          <article
                            key={note.noteId}
                            className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-[var(--app-text)]">
                                {note.title}
                              </p>
                              <StatusPill label={note.unitId} tone="neutral" />
                            </div>
                            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                              {note.summary}
                            </p>
                          </article>
                        ))}
                    </div>
                  ) : null}
                </Panel>
              )}

              <div className="grid gap-6 xl:grid-cols-3">
                <Panel
                  title="概念解析"
                  description="重点看概念、商业化路径和阶段判断。"
                >
                  <div className="grid gap-3">
                    {companyResult.conceptInsights.map((item) => (
                      <article
                        key={item.concept}
                        className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[15px] font-medium text-[var(--app-text)]">
                            {item.concept}
                          </p>
                          <StatusPill label={item.maturity} tone="info" />
                        </div>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--app-text-muted)]">
                          <p>{item.whyItMatters}</p>
                          <p>{item.companyFit}</p>
                          <p>{item.monetizationPath}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </Panel>

                <Panel
                  title="深问题与回答"
                  description="优先找出尚未被充分披露、但最影响投资判断的变量。"
                >
                  <div className="grid gap-3">
                    {companyResult.findings.map((item, index) => {
                      const question = companyResult.deepQuestions[index];
                      return (
                        <article
                          key={item.question}
                          className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[15px] font-medium text-[var(--app-text)]">
                              {item.question}
                            </p>
                            <StatusPill
                              label={item.confidence}
                              tone="warning"
                            />
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[var(--app-text)]">
                            {item.answer}
                          </p>
                          {question ? (
                            <p className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
                              目标指标: {question.targetMetric}
                            </p>
                          ) : null}
                          {item.gaps.length > 0 ? (
                            <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                              {item.gaps.map((gap) => (
                                <p key={gap}>- {gap}</p>
                              ))}
                            </div>
                          ) : null}
                          {item.referenceIds.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                              {item.referenceIds.map((referenceId) => {
                                const reference =
                                  companyReferenceMap.get(referenceId);

                                if (!reference) {
                                  return (
                                    <span
                                      key={referenceId}
                                      className="rounded-[8px] border border-[var(--app-border)] px-2 py-1 text-[var(--app-text-soft)]"
                                    >
                                      {referenceId}
                                    </span>
                                  );
                                }

                                return reference.url ? (
                                  <a
                                    key={referenceId}
                                    href={reference.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-[8px] border border-[var(--app-border)] px-2 py-1 text-[var(--app-accent-strong)] hover:underline"
                                  >
                                    {reference.title}
                                  </a>
                                ) : (
                                  <span
                                    key={referenceId}
                                    className="rounded-[8px] border border-[var(--app-border)] px-2 py-1 text-[var(--app-text-soft)]"
                                  >
                                    {reference.title}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </Panel>

                <Panel
                  title="网页证据"
                  description="抓取服务获取到的网页证据会优先出现在这里。"
                >
                  <div className="grid gap-3">
                    <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={
                            companyResult.crawler.configured
                              ? "Firecrawl 已启用"
                              : "Firecrawl 未配置"
                          }
                          tone={
                            companyResult.crawler.configured
                              ? "success"
                              : "warning"
                          }
                        />
                        <span className="text-xs text-[var(--app-text-soft)]">
                          查询数 {companyResult.crawler.queries.length}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                        {companyResult.crawler.queries.map((query) => (
                          <p key={query}>{query}</p>
                        ))}
                      </div>
                      {companyResult.crawler.notes.length > 0 ? (
                        <div className="mt-3 space-y-1 text-xs text-[var(--app-text-muted)]">
                          {companyResult.crawler.notes.map((note) => (
                            <p key={note}>- {note}</p>
                          ))}
                        </div>
                      ) : null}
                      {companyResult.collectionSummary ? (
                        <div className="mt-4 grid gap-2 text-xs text-[var(--app-text-muted)]">
                          <p>
                            原始证据{" "}
                            {companyResult.collectionSummary.totalRawCount}/
                            入选{" "}
                            {companyResult.collectionSummary.totalCuratedCount}/
                            引用{" "}
                            {
                              companyResult.collectionSummary
                                .totalReferenceCount
                            }
                          </p>
                          <p>
                            一手信源{" "}
                            {
                              companyResult.collectionSummary
                                .totalFirstPartyCount
                            }
                          </p>
                          {companyResult.collectionSummary.collectors.map(
                            (collector) => (
                              <p key={collector.collectorKey}>
                                {collector.label}：原始 {collector.rawCount} /
                                入选 {collector.curatedCount} / 一手{" "}
                                {collector.firstPartyCount}
                              </p>
                            ),
                          )}
                        </div>
                      ) : null}
                    </article>

                    {companyResult.evidence.map((item) => (
                      <article
                        key={`${item.referenceId}-${item.title}`}
                        className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill label={item.sourceType} tone="info" />
                          <StatusPill
                            label={item.isFirstParty ? "一手" : "外部"}
                            tone={item.isFirstParty ? "success" : "neutral"}
                          />
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-[var(--app-accent-strong)] hover:underline"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span className="text-sm text-[var(--app-text)]">
                              {item.title}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                          {item.sourceName} · {item.collectorKey}
                          {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[var(--app-text)]">
                          {item.extractedFact}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-[var(--app-text-muted)]">
                          {item.snippet}
                        </p>
                      </article>
                    ))}

                    {(companyResult.references ?? []).length > 0 ? (
                      <article className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                          引用列表
                        </p>
                        <div className="mt-3 grid gap-3">
                          {(companyResult.references ?? []).map((reference) => (
                            <div
                              key={reference.id}
                              className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusPill
                                  label={reference.sourceType}
                                  tone="neutral"
                                />
                                <StatusPill
                                  label={
                                    reference.isFirstParty
                                      ? "一手信源"
                                      : "外部信源"
                                  }
                                  tone={
                                    reference.isFirstParty
                                      ? "success"
                                      : "neutral"
                                  }
                                />
                                {reference.url ? (
                                  <a
                                    href={reference.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-[var(--app-accent-strong)] hover:underline"
                                  >
                                    {reference.title}
                                  </a>
                                ) : (
                                  <span className="text-sm text-[var(--app-text)]">
                                    {reference.title}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                                {reference.sourceName}
                                {reference.publishedAt
                                  ? ` · ${reference.publishedAt}`
                                  : ""}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[var(--app-text)]">
                                {reference.extractedFact}
                              </p>
                            </div>
                          ))}
                        </div>
                      </article>
                    ) : null}
                  </div>
                </Panel>
              </div>
            </>
          ) : resultHighlights.length > 0 ? (
            <Panel
              title="研究结论摘要"
              description="先看压缩后的结构化要点，再决定是否展开原始结果。"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {resultHighlights.map((item) => (
                  <article
                    key={item.key}
                    className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                  >
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                      {item.key}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[var(--app-text)]">
                      {item.value}
                    </p>
                  </article>
                ))}
              </div>
            </Panel>
          ) : null}

          <ResearchOpsPanels result={run.result} />

          <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
            <Panel
              title="研究步骤状态"
              description="每个节点保留处理器、起止时间和错误信息。"
            >
              {run.nodes.length === 0 ? (
                <EmptyState
                  title="还没有节点状态"
                  description="工作流开始执行后，节点状态会按顺序出现在这里。"
                />
              ) : (
                <div className="grid gap-3">
                  {run.nodes.map((node: RunNodeItem) => (
                    <article
                      key={node.id}
                      className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-medium text-[var(--app-text)]">
                            {node.nodeKey}
                          </p>
                          <p className="mt-1 text-xs text-[var(--app-text-soft)]">
                            处理器：{node.agentName}
                          </p>
                        </div>
                        <StatusPill
                          label={statusLabels[node.status] ?? node.status}
                          tone={statusTone(node.status)}
                        />
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-[var(--app-text-muted)] sm:grid-cols-3">
                        <p>开始：{formatDate(node.startedAt)}</p>
                        <p>结束：{formatDate(node.completedAt)}</p>
                        <p className="app-data">
                          耗时：{node.durationMs ?? "-"} 毫秒
                        </p>
                      </div>

                      {node.errorMessage ? (
                        <div className="mt-4 rounded-[10px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                          {node.errorCode ? `${node.errorCode}: ` : ""}
                          {node.errorMessage}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="事件时间线"
              description="数据库事件和实时推送事件会自动合并，按序号倒序展示。"
            >
              {timeline.length === 0 ? (
                <EmptyState
                  title="暂无事件"
                  description="只要工作流开始产生日志，时间线会立刻在这里滚动更新。"
                />
              ) : (
                <div className="grid gap-2">
                  {timeline.map((event: StreamEvent) => (
                    <article
                      key={`${event.sequence}-${event.type}`}
                      className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={`#${event.sequence}`}
                          tone="neutral"
                        />
                        <StatusPill
                          label={eventTypeLabelMap[event.type] ?? event.type}
                          tone="info"
                        />
                        <span className="text-xs text-[var(--app-text-soft)]">
                          {event.nodeKey ?? "主流程"}
                        </span>
                      </div>
                      <p className="app-data mt-3 text-[11px] text-[var(--app-text-soft)]">
                        {formatDate(event.timestamp)}
                      </p>
                    </article>
                  ))}
                </div>
              )}

              {streamError ? (
                <div className="mt-4 rounded-[10px] border border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] px-4 py-3 text-sm text-[var(--app-warning)]">
                  {streamError}
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel
            title="原始结果数据"
            description="需要更细节的研究输出时，再展开完整结果对象。"
          >
            <pre className="app-data app-scroll overflow-auto rounded-[10px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-4 text-xs leading-6 text-[var(--app-accent-strong)]">
              {JSON.stringify(run.result ?? {}, null, 2)}
            </pre>
          </Panel>
        </>
      )}
    </WorkspaceShell>
  );
}
