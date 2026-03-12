"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  EmptyState,
  KeyPointList,
  KpiCard,
  Panel,
  ProgressBar,
  StatusPill,
  statusTone,
  WorkspaceShell,
} from "~/app/_components/ui";
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

const starterCases = [
  {
    companyName: "英伟达",
    focusConcepts: `AI 服务器
数据中心网络
软件生态`,
    keyQuestion: "过去几个季度里，真正驱动利润率抬升的业务环节有哪些？",
  },
  {
    companyName: "特斯拉",
    focusConcepts: `储能
自动驾驶
机器人`,
    keyQuestion: "当前新业务增长是订单先行，还是利润已经开始兑现？",
  },
  {
    companyName: "药明康德",
    focusConcepts: `ADC
多肽
海外产能`,
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
    <article className="rounded-[18px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.88)] p-5">
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
            className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3"
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
    </article>
  );
}

export function CompanyResearchClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [companyName, setCompanyName] = useState("");
  const [stockCode, setStockCode] = useState("");
  const [officialWebsite, setOfficialWebsite] = useState("");
  const [focusConcepts, setFocusConcepts] = useState("");
  const [keyQuestion, setKeyQuestion] = useState("");
  const [supplementalUrls, setSupplementalUrls] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

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

  const liveRuns = sortedRuns.filter(
    (run) => run.status === "PENDING" || run.status === "RUNNING",
  );
  const finishedRuns = sortedRuns.filter((run) => run.status === "SUCCEEDED");

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
      idempotencyKey: idempotencyKey.trim() || undefined,
    });
  };

  return (
    <WorkspaceShell
      section="companyResearch"
      eyebrow="Company Judgement"
      title="公司判断"
      actions={
        <>
          <Link href="/" className="app-button">
            返回看板
          </Link>
          <Link href="/workflows" className="app-button app-button-primary">
            打开行业判断
          </Link>
          <Link href="/timing" className="app-button app-button-success">
            前往择时组合
          </Link>
        </>
      }
      summary={
        <>
          <KpiCard label="研究卡片" value={sortedRuns.length} tone="info" />
          <KpiCard label="进行中" value={liveRuns.length} tone="warning" />
          <KpiCard label="已完成" value={finishedRuns.length} tone="success" />
          <KpiCard
            label="最近更新"
            value={formatDate(sortedRuns[0]?.createdAt ?? null)}
            tone="neutral"
          />
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel
          title="发起公司判断"
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
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="公司名称，例如：英伟达"
              className="app-input"
            />
            <textarea
              value={keyQuestion}
              onChange={(event) => setKeyQuestion(event.target.value)}
              placeholder="最想优先确认的问题，例如：过去几个季度里，真正驱动利润率上行的业务环节有哪些？"
              className="app-textarea min-h-[150px]"
            />

            <details className="rounded-[14px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.82)] p-4">
              <summary className="cursor-pointer text-sm font-medium text-[var(--app-text)]">
                高级选项
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <input
                  value={stockCode}
                  onChange={(event) => setStockCode(event.target.value)}
                  placeholder="股票代码，可选"
                  className="app-input"
                />
                <input
                  value={officialWebsite}
                  onChange={(event) => setOfficialWebsite(event.target.value)}
                  placeholder="官网或 IR 地址，可选"
                  className="app-input"
                />
                <textarea
                  value={focusConcepts}
                  onChange={(event) => setFocusConcepts(event.target.value)}
                  placeholder="重点概念，每行一个，例如：AI 芯片、数据中心、软件生态"
                  className="app-textarea min-h-[140px]"
                />
                <textarea
                  value={supplementalUrls}
                  onChange={(event) => setSupplementalUrls(event.target.value)}
                  placeholder="补充 URL，每行一个，可选"
                  className="app-textarea min-h-[140px]"
                />
                <input
                  value={idempotencyKey}
                  onChange={(event) => setIdempotencyKey(event.target.value)}
                  placeholder="可选：幂等键，用于避免重复创建"
                  className="app-input md:col-span-2"
                />
              </div>
            </details>

            {startMutation.error ? (
              <div className="rounded-[12px] border border-[rgba(201,119,132,0.34)] bg-[rgba(81,33,43,0.2)] px-4 py-3 text-sm text-[var(--app-danger)]">
                {startMutation.error.message}
              </div>
            ) : null}
          </div>
        </Panel>

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
                className="rounded-[14px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.84)] px-4 py-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[rgba(16,21,29,0.94)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--app-text)]">
                    {item.companyName}
                  </p>
                  <StatusPill label="概念拆解" tone="info" />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                  {item.keyQuestion}
                </p>
              </button>
            ))}
            <p className="text-xs text-[var(--app-text-soft)]">
              点击填入样例。
            </p>
          </div>
        </Panel>
      </div>

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
          <div className="mt-4 rounded-[12px] border border-[rgba(201,119,132,0.34)] bg-[rgba(81,33,43,0.2)] px-4 py-3 text-sm text-[var(--app-danger)]">
            {runsQuery.error.message}
          </div>
        ) : null}
      </Panel>
    </WorkspaceShell>
  );
}
