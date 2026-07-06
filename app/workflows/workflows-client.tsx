"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MarketContextSection } from "~/app/_components/market-context-section";
import {
  InlineNotice,
  SectionCard,
  WorkspaceShell,
} from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { buildWorkflowRunHistoryItems } from "~/app/_components/workspace-history";
import { buildQuickResearchStartInput } from "~/app/workflows/quick-research-form";
import { workflowsStageTabs } from "~/app/workflows/workflows-stage-tabs";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import { api } from "~/trpc/react";

const quickPrompts = [
  "半导体设备国产替代里，未来 12 个月最关键的兑现节点是什么？",
  "创新药出海链条里，哪些商业化指标最值得持续跟踪？",
  "AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？",
];

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

  const sortedRuns = useMemo(() => {
    return [...(runsQuery.data?.items ?? [])].sort(
      (left, right) =>
        (right.createdAt?.getTime?.() ?? 0) -
        (left.createdAt?.getTime?.() ?? 0),
    );
  }, [runsQuery.data?.items]);
  const historyItems = useMemo(
    () => buildWorkflowRunHistoryItems(sortedRuns),
    [sortedRuns],
  );

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

  const questionPanel = (
    <SectionCard
      title="研究问题"
      description="先把问题写成可验证的投资判断，避免把后续步骤浪费在泛主题上。"
    >
      <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
        本轮要回答什么
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：AI 眼镜供应链里，哪些环节会最先兑现利润？"
          className="app-textarea min-h-[220px]"
        />
      </label>
    </SectionCard>
  );

  const constraintsPanel = (
    <SectionCard
      title="研究约束"
      description="限制信源、必答问题和时效窗口，让模型围绕当前判断收敛。"
    >
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
            onChange={(event) => setForbiddenEvidenceTypes(event.target.value)}
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

        <label className="flex items-start gap-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4 text-sm text-[var(--app-text-muted)] lg:col-span-2">
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
              首轮结构化节点直接走更重的推理路径，适合高歧义或高争议问题。
            </span>
          </span>
        </label>
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

  const launchPanel = (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
      <SectionCard
        title="发起执行"
        description="确认当前问题和约束后，再启动这一轮行业研究。"
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
          <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
            <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
              研究问题
            </div>
            <p className="mt-3 text-lg leading-8 text-[var(--app-text-strong)]">
              {query.trim() || "先在“研究问题”步骤里写下本轮判断。"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                约束摘要
              </div>
              <div className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
                研究目标：{researchGoal.trim() ? "已设置" : "未设置"}
                <br />
                必答问题：{mustAnswerQuestions.trim() ? "已设置" : "未设置"}
                <br />
                优先信源：{preferredSources.trim() ? "已设置" : "未设置"}
              </div>
            </div>

            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                执行模式
              </div>
              <div className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
                深度模式：{deepMode ? "开启" : "关闭"}
                <br />
                时效窗口：{freshnessWindowDays.trim() || "未设置"} 天
                <br />
                幂等键：{idempotencyKey.trim() || "未设置"}
              </div>
            </div>
          </div>

          {startMutation.error ? (
            <InlineNotice
              tone="danger"
              description={startMutation.error?.message ?? ""}
            />
          ) : null}
        </div>
      </SectionCard>

      {quickPromptPanel}
    </div>
  );

  return (
    <WorkspaceShell
      section="workflows"
      historyItems={historyItems}
      historyHref="/workflows/history"
      historyLoading={runsQuery.isLoading}
      historyEmptyText="还没有行业研究记录"
      title="行业研究"
      description="把研究问题和约束收进一条连续流程里，减少在多个页面之间切换。"
      actions={
        <>
          <Link href="/" className="app-button">
            返回总览
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
      <MarketContextSection section="workflows" />
      <WorkflowStageSwitcher
        tabs={workflowsStageTabs}
        activeTabId={activeTabId}
        onChange={setActiveTabId}
        panels={{
          question: questionPanel,
          constraints: constraintsPanel,
          launch: launchPanel,
        }}
      />
    </WorkspaceShell>
  );
}
