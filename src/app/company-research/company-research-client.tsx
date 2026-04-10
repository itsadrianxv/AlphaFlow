"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { statusTone } from "~/app/_components/status-tone";
import {
  EmptyState,
  InlineNotice,
  KeyPointList,
  Panel,
  ProgressBar,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { buildWorkflowRunHistoryItems } from "~/app/_components/workspace-history";
import { companyResearchStageTabs } from "~/app/company-research/company-research-stage-tabs";
import { buildResearchDigest } from "~/app/workflows/research-view-models";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";
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

function parseLines(value: string) {
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrlInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const statusLabelMap: Record<string, string> = {
  PENDING: "等待执行",
  RUNNING: "研究进行中",
  SUCCEEDED: "结论已生成",
  FAILED: "需要重跑",
  CANCELLED: "已取消",
};

statusLabelMap.PAUSED = "已暂停";

const starterCases = [
  {
    companyName: "英伟达",
    focusConcepts: "AI 服务器\n数据中心网络\n软件生态",
    keyQuestion: "过去几个季度里，真正驱动利润率抬升的业务环节有哪些？",
  },
  {
    companyName: "特斯拉",
    focusConcepts: "储能\n自动驾驶\n机器人",
    keyQuestion: "当前新业务增长是订单先行，还是利润已经开始兑现？",
  },
  {
    companyName: "药明康德",
    focusConcepts: "ADC\n多肽\n海外产能",
    keyQuestion: "新业务增长背后，哪些指标能够证明需求与利润同步兑现？",
  },
];

type RunListItem = RouterOutputs["workflow"]["listRuns"]["items"][number];

function CompanyRunCard({
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

  return (
    <Panel surface="inset" density="compact">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="公司判断" tone="info" />
            <StatusPill
              label={statusLabelMap[run.status] ?? run.status}
              tone={statusTone(run.status)}
            />
            <StatusPill label={digest.verdictLabel} tone={digest.verdictTone} />
          </div>
          <p className="mt-3 text-lg font-medium text-[var(--app-text)]">
            {run.query}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
            {digest.summary}
          </p>
        </div>

        <div className="text-right text-xs text-[var(--app-text-soft)]">
          <p>{formatDate(run.createdAt)}</p>
          {run.status === "RUNNING" || run.status === "PENDING" ? (
            <p className="mt-2">{run.currentNodeKey ?? "等待更新"}</p>
          ) : null}
        </div>
      </div>

      {run.status === "RUNNING" || run.status === "PENDING" ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
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
            className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3"
          >
            <div className="text-xs text-[var(--app-text-soft)]">
              {metric.label}
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-4">
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
          title="证据摘要"
          items={digest.evidence}
          emptyText="查看详情。"
          tone="info"
        />
        <KeyPointList
          title="待核验动作"
          items={
            digest.nextActions.length > 0 ? digest.nextActions : digest.gaps
          }
          emptyText="查看详情。"
          tone="neutral"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--app-text-soft)]">
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
    </Panel>
  );
}

export function CompanyResearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const [companyName, setCompanyName] = useState("");
  const [stockCode, setStockCode] = useState("");
  const [officialWebsite, setOfficialWebsite] = useState("");
  const [focusConcepts, setFocusConcepts] = useState("");
  const [keyQuestion, setKeyQuestion] = useState("");
  const [supplementalUrls, setSupplementalUrls] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [researchGoal, setResearchGoal] = useState("");
  const [mustAnswerQuestions, setMustAnswerQuestions] = useState("");
  const [forbiddenEvidenceTypes, setForbiddenEvidenceTypes] = useState("");
  const [preferredSources, setPreferredSources] = useState("");
  const [freshnessWindowDays, setFreshnessWindowDays] = useState("180");
  const [activeTabId, setActiveTabId] = useState(
    companyResearchStageTabs[0]?.id ?? "target",
  );

  useEffect(() => {
    const mappings = [
      ["companyName", setCompanyName],
      ["stockCode", setStockCode],
      ["officialWebsite", setOfficialWebsite],
      ["focusConcepts", setFocusConcepts],
      ["keyQuestion", setKeyQuestion],
      ["supplementalUrls", setSupplementalUrls],
      ["researchGoal", setResearchGoal],
      ["mustAnswerQuestions", setMustAnswerQuestions],
      ["forbiddenEvidenceTypes", setForbiddenEvidenceTypes],
      ["preferredSources", setPreferredSources],
      ["freshnessWindowDays", setFreshnessWindowDays],
    ] as const;

    for (const [key, setter] of mappings) {
      const value = searchParams.get(key);
      if (value) {
        setter(value);
      }
    }
  }, [searchParams]);

  const runsQuery = api.workflow.listRuns.useQuery({
    limit: 20,
    templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
  });

  const startMutation = api.workflow.startCompanyResearch.useMutation({
    onSuccess: async (result) => {
      await utils.workflow.listRuns.invalidate({
        limit: 20,
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      });
      router.push(`/workflows/${result.runId}`);
    },
  });

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.listRuns.invalidate({
        limit: 20,
        templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
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
  const historyItems = useMemo(
    () => buildWorkflowRunHistoryItems(sortedRuns),
    [sortedRuns],
  );

  const handleStart = async () => {
    if (!companyName.trim()) {
      return;
    }

    const normalizedSupplementalUrls = parseLines(supplementalUrls)
      .map(normalizeUrlInput)
      .filter((item): item is string => Boolean(item));

    await startMutation.mutateAsync({
      companyName: companyName.trim(),
      stockCode: stockCode.trim() || undefined,
      officialWebsite: normalizeUrlInput(officialWebsite),
      focusConcepts: parseLines(focusConcepts),
      keyQuestion: keyQuestion.trim() || undefined,
      supplementalUrls: normalizedSupplementalUrls,
      researchPreferences:
        researchGoal.trim() ||
        mustAnswerQuestions.trim() ||
        forbiddenEvidenceTypes.trim() ||
        preferredSources.trim() ||
        freshnessWindowDays.trim()
          ? {
              researchGoal: researchGoal.trim() || undefined,
              mustAnswerQuestions: parseLines(mustAnswerQuestions),
              forbiddenEvidenceTypes: parseLines(forbiddenEvidenceTypes),
              preferredSources: parseLines(preferredSources),
              freshnessWindowDays:
                Number.parseInt(freshnessWindowDays.trim(), 10) || undefined,
            }
          : undefined,
      idempotencyKey: idempotencyKey.trim() || undefined,
    });
  };

  const targetPanel = (
    <Panel
      title="研究目标"
      description="先锁定公司、代码和当前最想验证的核心判断。"
    >
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="公司名称，例如：英伟达"
            className="app-input"
          />
          <input
            value={stockCode}
            onChange={(event) => setStockCode(event.target.value)}
            placeholder="股票代码，可选"
            className="app-input"
          />
        </div>
        <textarea
          value={keyQuestion}
          onChange={(event) => setKeyQuestion(event.target.value)}
          placeholder="最想优先确认的问题，例如：过去几个季度里，真正驱动利润率上行的业务环节有哪些？"
          className="app-textarea min-h-[180px]"
        />
      </div>
    </Panel>
  );

  const sourcesPanel = (
    <Panel
      title="证据来源"
      description="补充官网、概念线索和研究偏好，让证据链从一开始就可控。"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <input
          value={officialWebsite}
          onChange={(event) => setOfficialWebsite(event.target.value)}
          placeholder="官网或投资者关系地址，可选"
          className="app-input"
        />
        <input
          value={idempotencyKey}
          onChange={(event) => setIdempotencyKey(event.target.value)}
          placeholder="幂等键，可选"
          className="app-input"
        />
        <textarea
          value={focusConcepts}
          onChange={(event) => setFocusConcepts(event.target.value)}
          placeholder="重点概念，每行一个。"
          className="app-textarea min-h-[140px]"
        />
        <textarea
          value={supplementalUrls}
          onChange={(event) => setSupplementalUrls(event.target.value)}
          placeholder="补充链接，每行一个。"
          className="app-textarea min-h-[140px]"
        />
        <textarea
          value={researchGoal}
          onChange={(event) => setResearchGoal(event.target.value)}
          placeholder="可选：本次研究目标。"
          className="app-textarea min-h-[120px]"
        />
        <textarea
          value={mustAnswerQuestions}
          onChange={(event) => setMustAnswerQuestions(event.target.value)}
          placeholder="可选：必答问题，每行一条。"
          className="app-textarea min-h-[120px]"
        />
        <textarea
          value={preferredSources}
          onChange={(event) => setPreferredSources(event.target.value)}
          placeholder="可选：优先信源。"
          className="app-textarea min-h-[120px]"
        />
        <textarea
          value={forbiddenEvidenceTypes}
          onChange={(event) => setForbiddenEvidenceTypes(event.target.value)}
          placeholder="可选：禁用证据类型。"
          className="app-textarea min-h-[120px]"
        />
        <input
          value={freshnessWindowDays}
          onChange={(event) => setFreshnessWindowDays(event.target.value)}
          placeholder="可选：时效窗口（天）"
          className="app-input md:col-span-2"
        />
      </div>
    </Panel>
  );

  const starterPanel = (
    <Panel title="快速样例">
      <div className="grid gap-3">
        {starterCases.map((item) => (
          <button
            key={item.companyName}
            type="button"
            onClick={() => {
              setCompanyName(item.companyName);
              setFocusConcepts(item.focusConcepts);
              setKeyQuestion(item.keyQuestion);
            }}
            className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--app-flame)]"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--app-text-strong)]">
                {item.companyName}
              </p>
              <StatusPill label="概念拆解" tone="info" />
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
              {item.keyQuestion}
            </p>
          </button>
        ))}
      </div>
    </Panel>
  );

  const launchPanel = (
    <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
      <Panel
        title="发起执行"
        description="确认本轮公司判断的目标和证据边界，再开始生成结论。"
        actions={
          <button
            type="button"
            onClick={handleStart}
            disabled={startMutation.isPending || !companyName.trim()}
            className="app-button app-button-primary"
          >
            {startMutation.isPending ? "正在生成判断" : "开始判断"}
          </button>
        }
      >
        <div className="grid gap-4">
          <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
            <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
              研究对象
            </div>
            <p className="mt-3 text-lg leading-8 text-[var(--app-text-strong)]">
              {companyName.trim() || "先在“研究目标”步骤里选择公司。"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {keyQuestion.trim() || "当前还没有填写核心判断问题。"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                证据边界
              </div>
              <div className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
                官网：{officialWebsite.trim() ? "已设置" : "未设置"}
                <br />
                概念线索：{focusConcepts.trim() ? "已设置" : "未设置"}
                <br />
                补充链接：{supplementalUrls.trim() ? "已设置" : "未设置"}
              </div>
            </div>
            <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                研究偏好
              </div>
              <div className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
                研究目标：{researchGoal.trim() ? "已设置" : "未设置"}
                <br />
                必答问题：{mustAnswerQuestions.trim() ? "已设置" : "未设置"}
                <br />
                时效窗口：{freshnessWindowDays.trim() || "未设置"} 天
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
      </Panel>

      {starterPanel}
    </div>
  );

  const findingsPanel = (
    <Panel
      title="最新公司判断"
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
        <EmptyState title="正在加载公司判断" />
      ) : sortedRuns.length === 0 ? (
        <EmptyState title="还没有公司判断记录" />
      ) : (
        <div className="grid gap-4">
          {sortedRuns.map((run) => (
            <CompanyRunCard
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
    </Panel>
  );

  return (
    <WorkspaceShell
      section="companyResearch"
      historyItems={historyItems}
      historyHref="/company-research/history"
      historyLoading={runsQuery.isLoading}
      historyEmptyText="还没有公司判断记录"
      eyebrow="公司判断"
      title="公司判断"
      actions={
        <>
          <Link href="/" className="app-button">
            返回看板
          </Link>
          <Link href="/workflows" className="app-button app-button-primary">
            打开行业研究
          </Link>
          <Link href="/timing" className="app-button app-button-success">
            前往择时组合
          </Link>
        </>
      }
    >
      <WorkflowStageSwitcher
        tabs={companyResearchStageTabs}
        activeTabId={activeTabId}
        onChange={setActiveTabId}
        panels={{
          target: targetPanel,
          sources: sourcesPanel,
          launch: launchPanel,
          findings: findingsPanel,
        }}
      />
    </WorkspaceShell>
  );
}
