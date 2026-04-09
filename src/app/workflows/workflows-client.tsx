"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { statusTone } from "~/app/_components/status-tone";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import {
  EmptyState,
  InlineNotice,
  KeyPointList,
  LoadingSkeleton,
  ProgressBar,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { buildQuickResearchStartInput } from "~/app/workflows/quick-research-form";
import {
  buildResearchDigest,
  type InvestorTone,
} from "~/app/workflows/research-view-models";
import { workflowsStageTabs } from "~/app/workflows/workflows-stage-tabs";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import { api, type RouterOutputs } from "~/trpc/react";

function formatDate(value?: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

const statusLabelMap: Record<string, string> = {
  PENDING: "等待执行",
  RUNNING: "研究进行中",
  SUCCEEDED: "结论已生成",
  FAILED: "需要重试",
  CANCELLED: "已取消",
};

statusLabelMap.PAUSED = "已暂停";

const quickPrompts = [
  "半导体设备国产替代，未来 12 个月最关键的兑现节点是什么？",
  "创新药出海链条里，哪些商业化指标最值得持续跟踪？",
  "AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？",
];

type RunListItem = RouterOutputs["workflow"]["listRuns"]["items"][number];

function InvestorRunCard({
  run,
  onCancel,
}: {
  run: RunListItem;
  onCancel: (runId: string) => void;
}) {
  const detailQuery = api.workflow.getRun.useQuery(
    { runId: run.id },
    {
      enabled: run.status === "SUCCEEDED",
      refetchOnWindowFocus: false,
    },
  );

  const digest = buildResearchDigest({
    templateCode: run.templateCode,
    query: run.query,
    status: run.status,
    progressPercent: run.progressPercent,
    currentNodeKey: run.currentNodeKey,
    result: detailQuery.data?.result,
  });

  const verdictTone: InvestorTone =
    run.status === "FAILED" ? "danger" : digest.verdictTone;

  return (
    <SectionCard surface="inset" density="compact">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={digest.templateLabel} tone="info" />
            <StatusPill
              label={statusLabelMap[run.status] ?? run.status}
              tone={statusTone(run.status)}
            />
            <StatusPill label={digest.verdictLabel} tone={verdictTone} />
          </div>
          <div className="mt-3 text-lg font-medium text-[var(--app-text-strong)]">
            {run.query}
          </div>
          <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
            {digest.summary}
          </div>
        </div>

        <div className="text-right text-xs text-[var(--app-text-subtle)]">
          <p>{formatDate(run.createdAt)}</p>
          {run.status === "RUNNING" || run.status === "PENDING" ? (
            <p className="mt-2">{run.currentNodeKey ?? "等待更新"}</p>
          ) : null}
        </div>
      </div>

      {run.status === "RUNNING" || run.status === "PENDING" ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--app-text-subtle)]">
            <span>当前进度</span>
            <span>{run.progressPercent}%</span>
          </div>
          <ProgressBar
            value={run.progressPercent}
            tone={statusTone(run.status)}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {digest.metrics.slice(0, 4).map((metric) => (
          <div
            key={`${run.id}-${metric.label}`}
            className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3"
          >
            <div className="text-xs text-[var(--app-text-subtle)]">
              {metric.label}
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text-strong)]">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <KeyPointList
          title="看多理由"
          items={digest.bullPoints}
          emptyText="待更新。"
          tone="success"
        />
        <KeyPointList
          title="风险点"
          items={digest.bearPoints}
          emptyText="未标注。"
          tone="warning"
        />
        <KeyPointList
          title="下一步动作"
          items={digest.nextActions}
          emptyText="查看详情。"
          tone="info"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--app-text-subtle)]">
          {digest.headline}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/workflows/${run.id}`}
            className="app-button app-button-primary"
          >
            查看结论
          </Link>
          {(run.status === "PENDING" || run.status === "RUNNING") && (
            <button
              type="button"
              onClick={() => onCancel(run.id)}
              className="app-button app-button-danger"
            >
              取消研究
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function WorkflowsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const [query, setQuery] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [researchGoal, setResearchGoal] = useState("");
  const [mustAnswerQuestions, setMustAnswerQuestions] = useState("");
  const [forbiddenEvidenceTypes, setForbiddenEvidenceTypes] = useState("");
  const [preferredSources, setPreferredSources] = useState("");
  const [freshnessWindowDays, setFreshnessWindowDays] = useState("180");
  const [deepMode, setDeepMode] = useState(false);
  const [activeTabId, setActiveTabId] = useState(
    workflowsStageTabs[0]?.id ?? "question",
  );

  useEffect(() => {
    const nextQuery = searchParams.get("query");
    const nextResearchGoal = searchParams.get("researchGoal");
    const nextMustAnswerQuestions = searchParams.get("mustAnswerQuestions");
    const nextForbiddenEvidenceTypes = searchParams.get(
      "forbiddenEvidenceTypes",
    );
    const nextPreferredSources = searchParams.get("preferredSources");
    const nextFreshnessWindowDays = searchParams.get("freshnessWindowDays");

    if (nextQuery) {
      setQuery(nextQuery);
    }
    if (nextResearchGoal) {
      setResearchGoal(nextResearchGoal);
    }
    if (nextMustAnswerQuestions) {
      setMustAnswerQuestions(nextMustAnswerQuestions);
    }
    if (nextForbiddenEvidenceTypes) {
      setForbiddenEvidenceTypes(nextForbiddenEvidenceTypes);
    }
    if (nextPreferredSources) {
      setPreferredSources(nextPreferredSources);
    }
    if (nextFreshnessWindowDays) {
      setFreshnessWindowDays(nextFreshnessWindowDays);
    }
  }, [searchParams]);

  const runsQuery = api.workflow.listRuns.useQuery({
    limit: 20,
    templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
  });

  const startMutation = api.workflow.startQuickResearch.useMutation({
    onSuccess: async (result) => {
      await utils.workflow.listRuns.invalidate({
        limit: 20,
        templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      });
      router.push(`/workflows/${result.runId}`);
    },
  });

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.listRuns.invalidate({
        limit: 20,
        templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      });
    },
  });

  const sortedRuns = useMemo(() => {
    return [...(runsQuery.data?.items ?? [])].sort(
      (left, right) =>
        (right.createdAt?.getTime?.() ?? 0) -
        (left.createdAt?.getTime?.() ?? 0),
    );
  }, [runsQuery.data?.items]);

  const handleStart = async () => {
    if (!query.trim()) {
      return;
    }

    await startMutation.mutateAsync(
      buildQuickResearchStartInput({
        query,
        idempotencyKey,
        researchGoal,
        mustAnswerQuestions,
        forbiddenEvidenceTypes,
        preferredSources,
        freshnessWindowDays,
        deepMode,
      }),
    );
  };

  const launchFormPanel = (
    <SectionCard
      title="发起行业研究"
      description="直接输入研究问题；如需限制证据范围、时效或必答问题，在下方补充约束。"
      actions={
        <button
          type="button"
          onClick={handleStart}
          disabled={startMutation.isPending || !query.trim()}
          className="app-button app-button-primary"
        >
          {startMutation.isPending ? "正在生成判断" : "开始研究"}
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
          研究问题
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：AI 眼镜供应链里，哪些环节会最先兑现利润？"
            className="app-textarea min-h-[180px]"
          />
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            研究目标
            <textarea
              value={researchGoal}
              onChange={(event) => setResearchGoal(event.target.value)}
              placeholder="可选：本次研究最想得到的判断。"
              className="app-textarea min-h-[110px]"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            必答问题
            <textarea
              value={mustAnswerQuestions}
              onChange={(event) => setMustAnswerQuestions(event.target.value)}
              placeholder="可选：每行一个必须回答的问题。"
              className="app-textarea min-h-[110px]"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            优先信源
            <textarea
              value={preferredSources}
              onChange={(event) => setPreferredSources(event.target.value)}
              placeholder="可选：每行一个优先信源。"
              className="app-textarea min-h-[96px]"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            禁用证据类型
            <textarea
              value={forbiddenEvidenceTypes}
              onChange={(event) =>
                setForbiddenEvidenceTypes(event.target.value)
              }
              placeholder="可选：每行一个禁用证据类型。"
              className="app-textarea min-h-[96px]"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            时效窗口（天）
            <input
              value={freshnessWindowDays}
              onChange={(event) => setFreshnessWindowDays(event.target.value)}
              placeholder="例如 180"
              className="app-input"
            />
          </label>

          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            幂等键
            <input
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              placeholder="用于避免重复创建"
              className="app-input"
            />
          </label>
        </div>

        {startMutation.error ? (
          <InlineNotice
            tone="danger"
            description={startMutation.error?.message ?? ""}
          />
        ) : null}
      </div>
    </SectionCard>
  );

  const quickPromptPanel = (
    <SectionCard
      title="常用问题模板"
      description="点击填入后可以继续补充约束，再直接发起研究。"
    >
      <div className="grid gap-3">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setQuery(prompt)}
            className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-left text-sm leading-6 text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-flame)] hover:text-[var(--app-text-strong)]"
          >
            {prompt}
          </button>
        ))}

        <div className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4">
          <div className="text-sm text-[var(--app-text-strong)]">使用建议</div>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
            <li>把问题写成可验证的投资判断，而不是泛泛主题。</li>
            <li>如果已经有假设，可以放到“必答问题”里让结果更聚焦。</li>
            <li>当研究对时效敏感时，缩短窗口以减少旧证据干扰。</li>
          </ul>
        </div>
      </div>
    </SectionCard>
  );

  const queuePanel = (
    <SectionCard
      title="最近运行"
      description="按最新时间排序，集中查看行业研究进度、指标和结论摘要。"
      actions={
        <button
          type="button"
          onClick={() => runsQuery.refetch()}
          className="app-button"
        >
          刷新列表
        </button>
      }
    >
      {runsQuery.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : sortedRuns.length === 0 ? (
        <EmptyState title="还没有行业研究记录" />
      ) : (
        <div className="grid gap-4">
          {sortedRuns.map((run) => (
            <InvestorRunCard
              key={run.id}
              run={run}
              onCancel={(runId) => cancelMutation.mutate({ runId })}
            />
          ))}
        </div>
      )}

      {runsQuery.error ? (
        <InlineNotice
          tone="danger"
          description={runsQuery.error?.message ?? ""}
          className="mt-4"
        />
      ) : null}
    </SectionCard>
  );

  return (
    <WorkspaceShell
      section="workflows"
      title="行业研究"
      description="把研究问题、约束和最近结论收进一条连续流程里，减少在多个页面之间切换。"
      actions={
        <>
          <Link href="/" className="app-button">
            返回总览
          </Link>
          <Link href="/workflows/history" className="app-button">
            历史记录
          </Link>
          <Link href="/company-research" className="app-button">
            公司研究
          </Link>
          <Link href="/screening" className="app-button app-button-primary">
            股票筛选
          </Link>
        </>
      }
    >
      <WorkflowStageSwitcher
        tabs={workflowsStageTabs}
        activeTabId={activeTabId}
        onChange={setActiveTabId}
        panels={{
          question: launchFormPanel,
          constraints: launchFormPanel,
          launch: (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
              {launchFormPanel}
              {quickPromptPanel}
            </div>
          ),
          queue: queuePanel,
        }}
      />
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell
      section="workflows"
      title="行业研究"
      description="把研究问题、约束和偏好收在一个入口里，统一查看最近运行与结论摘要。"
      actions={
        <>
          <Link href="/" className="app-button">
            返回总览
          </Link>
          <Link href="/workflows/history" className="app-button">
            历史记录
          </Link>
          <Link href="/company-research" className="app-button">
            公司研究
          </Link>
          <Link href="/screening" className="app-button app-button-primary">
            股票筛选
          </Link>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <SectionCard
          title="发起行业研究"
          description="直接输入研究问题；如果需要控制证据范围、时效或必答问题，在下方补充约束。"
          actions={
            <button
              type="button"
              onClick={handleStart}
              disabled={startMutation.isPending || !query.trim()}
              className="app-button app-button-primary"
            >
              {startMutation.isPending ? "正在生成判断" : "开始研究"}
            </button>
          }
        >
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              研究问题
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：AI 眼镜供应链中，哪些环节会最先兑现利润？"
                className="app-textarea min-h-[180px]"
              />
            </label>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex items-start gap-3 rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] px-4 py-3 text-sm text-[var(--app-text-muted)] lg:col-span-2">
                <input
                  type="checkbox"
                  checked={deepMode}
                  onChange={(event) => setDeepMode(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-[var(--app-text-strong)]">
                    深度模式
                  </span>
                  <span className="mt-1 block leading-6 text-[var(--app-text-muted)]">
                    首轮结构化节点直接使用 DeepSeek Reasoner。关闭时默认先走
                    chat，仅在严重问题时自动升级。
                  </span>
                </span>
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                研究目标
                <textarea
                  value={researchGoal}
                  onChange={(event) => setResearchGoal(event.target.value)}
                  placeholder="可选：本次研究最想得到的判断。"
                  className="app-textarea min-h-[110px]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                必答问题
                <textarea
                  value={mustAnswerQuestions}
                  onChange={(event) =>
                    setMustAnswerQuestions(event.target.value)
                  }
                  placeholder="可选：每行一个需要回答的问题。"
                  className="app-textarea min-h-[110px]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                优先信源
                <textarea
                  value={preferredSources}
                  onChange={(event) => setPreferredSources(event.target.value)}
                  placeholder="可选：每行一个优先信源。"
                  className="app-textarea min-h-[96px]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                禁用证据类型
                <textarea
                  value={forbiddenEvidenceTypes}
                  onChange={(event) =>
                    setForbiddenEvidenceTypes(event.target.value)
                  }
                  placeholder="可选：每行一个禁用证据类型。"
                  className="app-textarea min-h-[96px]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                时效窗口（天）
                <input
                  value={freshnessWindowDays}
                  onChange={(event) =>
                    setFreshnessWindowDays(event.target.value)
                  }
                  placeholder="例如 180"
                  className="app-input"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                幂等键
                <input
                  value={idempotencyKey}
                  onChange={(event) => setIdempotencyKey(event.target.value)}
                  placeholder="用于避免重复创建"
                  className="app-input"
                />
              </label>
            </div>

            {startMutation.error ? (
              <InlineNotice
                tone="danger"
                description={startMutation.error?.message ?? ""}
              />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="常用问题模板"
          description="点击填入后可以继续补充约束，再直接发起研究。"
        >
          <div className="grid gap-3">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setQuery(prompt)}
                className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] px-4 py-3 text-left text-sm leading-6 text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-bg-floating)] hover:text-[var(--app-text-strong)]"
              >
                {prompt}
              </button>
            ))}

            <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
              <div className="text-sm font-medium text-[var(--app-text-strong)]">
                使用建议
              </div>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
                <li>把问题写成可验证的投资判断，而不是泛泛主题。</li>
                <li>如果你已经有假设，可以放到“必答问题”里让结果更聚焦。</li>
                <li>当研究对时效敏感时，缩短时效窗口以减少旧证据干扰。</li>
              </ul>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="最近运行"
        description="按最新时间排序，集中查看行业研究的进度、核心指标和结论摘要。"
        actions={
          <button
            type="button"
            onClick={() => runsQuery.refetch()}
            className="app-button"
          >
            刷新列表
          </button>
        }
      >
        {runsQuery.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : sortedRuns.length === 0 ? (
          <EmptyState title="还没有行业研究记录" />
        ) : (
          <div className="grid gap-4">
            {sortedRuns.map((run) => (
              <InvestorRunCard
                key={run.id}
                run={run}
                onCancel={(runId) => cancelMutation.mutate({ runId })}
              />
            ))}
          </div>
        )}

        {runsQuery.error ? (
          <InlineNotice
            tone="danger"
            description={runsQuery.error?.message ?? ""}
            className="mt-4"
          />
        ) : null}
      </SectionCard>
    </WorkspaceShell>
  );
}
