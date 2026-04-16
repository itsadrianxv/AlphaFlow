"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in tests. */
import React, { useMemo, useState } from "react";

import { MarkdownContent } from "~/app/_components/markdown-content";
import {
  EmptyState,
  KeyPointList,
  Panel,
  StatusPill,
  type Tone,
} from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import {
  formatRuntimeIssueLabel,
  formatSourceTierLabel,
  formatSourceTypeLabel,
  formatWorkflowNodeLabel,
} from "~/app/workflows/detail-labels";
import {
  buildResearchDigest,
  extractConfidenceAnalysis,
  isCompanyResearchResult,
  type ResearchDigest,
} from "~/app/workflows/research-view-models";
import type { ConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  type CompanyResearchReferenceItem,
  type CompanyResearchResultDto,
} from "~/server/domain/workflow/types";

const companyResearchDetailTabs: WorkflowStageTab[] = [
  {
    id: "summary",
    label: "投资结论",
    summary: "先看立场、理由、风险和下一步动作。",
  },
  {
    id: "concepts",
    label: "业务与概念",
    summary: "聚焦业务契合点、概念兑现和变现路径。",
  },
  {
    id: "questions",
    label: "关键问题",
    summary: "按研究问题查看答案、置信度和证据预览。",
  },
  {
    id: "references",
    label: "引用与来源",
    summary: "审查证据覆盖、来源类型和引用内容。",
  },
];

type CompanyResearchBackgroundItem = {
  label: string;
  value: string;
};

type CompanyResearchConceptCard = {
  id: string;
  concept: string;
  whyItMatters: string;
  companyFit: string;
  monetizationPath: string;
  maturity: string;
};

type CompanyResearchQuestionCard = {
  id: string;
  question: string;
  whyImportant: string;
  targetMetric: string;
  dataHint: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  referenceCount: number;
  gapCount: number;
  gaps: string[];
  referencePreview: CompanyResearchReferenceItem[];
};

type CompanyResearchReferenceFilter = {
  id: string;
  label: string;
  count: number;
};

type CompanyResearchDetailModel = {
  kind: "detail";
  backgroundItems: CompanyResearchBackgroundItem[];
  digest: ResearchDigest;
  confidenceSummary: {
    score: string;
    level: string;
    coverage: string;
    notes: string[];
  };
  conceptCards: CompanyResearchConceptCard[];
  questionCards: CompanyResearchQuestionCard[];
  referenceFilters: CompanyResearchReferenceFilter[];
  collectors: CompanyResearchResultDto["collectionSummary"]["collectors"];
  references: CompanyResearchReferenceItem[];
  referenceStats: Array<{
    label: string;
    value: string;
  }>;
};

type CompanyResearchPausedFallbackModel = {
  kind: "paused_fallback";
  backgroundItems: CompanyResearchBackgroundItem[];
  blockers: string[];
  nextActions: string[];
};

export type CompanyResearchDetailPageModel =
  | CompanyResearchDetailModel
  | CompanyResearchPausedFallbackModel;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(items: Array<string | undefined>, limit = 6) {
  return [
    ...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]),
  ].slice(0, limit);
}

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
  }).format(date);
}

function formatStatusLabel(status?: string) {
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
      return "未知";
  }
}

function formatConfidenceLevel(level?: string) {
  switch (level) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "未知";
  }
}

function confidenceTone(level?: string): Tone {
  switch (level) {
    case "high":
      return "success";
    case "medium":
      return "info";
    case "low":
      return "warning";
    default:
      return "neutral";
  }
}

function buildBackgroundItemsFromBrief(params: {
  companyName?: string;
  stockCode?: string;
  researchGoal?: string;
  focusConcepts?: string[];
  status?: string;
  generatedAt?: Date | string | null;
}) {
  return [
    {
      label: "公司名称",
      value: params.companyName?.trim() || "-",
    },
    {
      label: "股票代码",
      value: params.stockCode?.trim() || "-",
    },
    {
      label: "研究目标",
      value: params.researchGoal?.trim() || "-",
    },
    {
      label: "关注概念",
      value:
        params.focusConcepts && params.focusConcepts.length > 0
          ? params.focusConcepts.join(" / ")
          : "-",
    },
    {
      label: "状态",
      value: formatStatusLabel(params.status),
    },
    {
      label: "生成时间",
      value: formatDate(params.generatedAt),
    },
  ];
}

function findConfidenceSummary(analysis: ConfidenceAnalysis | null) {
  return {
    score:
      analysis?.finalScore === null || analysis?.finalScore === undefined
        ? "未分析"
        : String(analysis.finalScore),
    level: formatConfidenceLevel(analysis?.level),
    coverage:
      analysis?.evidenceCoverageScore === undefined
        ? "未分析"
        : `${analysis.evidenceCoverageScore}%`,
    notes: uniqueList(analysis?.notes ?? [], 3),
  };
}

function buildQuestionCards(result: CompanyResearchResultDto) {
  const referenceMap = new Map(
    result.references.map((item) => [item.id, item] as const),
  );
  const findingByQuestion = new Map(
    result.findings.map((item) => [item.question, item] as const),
  );
  const questionKeys = [
    ...new Set([
      ...result.deepQuestions.map((item) => item.question),
      ...result.findings.map((item) => item.question),
    ]),
  ];

  return questionKeys.map((question, index) => {
    const deepQuestion =
      result.deepQuestions.find((item) => item.question === question) ?? null;
    const finding = findingByQuestion.get(question) ?? null;
    const referencePreview = (finding?.referenceIds ?? [])
      .map((item) => referenceMap.get(item))
      .filter((item): item is CompanyResearchReferenceItem => Boolean(item))
      .slice(0, 3);

    return {
      id: `question-${index + 1}`,
      question,
      whyImportant:
        deepQuestion?.whyImportant ?? "用于验证本次公司研究核心假设。",
      targetMetric: deepQuestion?.targetMetric ?? "待补充",
      dataHint: deepQuestion?.dataHint ?? "待补充",
      answer: finding?.answer ?? "暂无结构化回答。",
      confidence: finding?.confidence ?? "low",
      referenceCount: finding?.referenceIds.length ?? referencePreview.length,
      gapCount: finding?.gaps.length ?? 0,
      gaps: finding?.gaps ?? [],
      referencePreview,
    } satisfies CompanyResearchQuestionCard;
  });
}

function buildReferenceFilters(references: CompanyResearchReferenceItem[]) {
  const sourceTypes = ["official", "financial", "news", "industry"] as const;
  const filters: CompanyResearchReferenceFilter[] = [
    { id: "all", label: "全部", count: references.length },
    ...sourceTypes.map((type) => ({
      id: type,
      label: formatSourceTypeLabel(type),
      count: references.filter((item) => item.sourceType === type).length,
    })),
    {
      id: "first_party",
      label: "一手",
      count: references.filter((item) => item.sourceTier === "first_party")
        .length,
    },
    {
      id: "third_party",
      label: "三方",
      count: references.filter((item) => item.sourceTier === "third_party")
        .length,
    },
  ];

  return filters.filter((item) => item.id === "all" || item.count > 0);
}

function filterReferences(
  references: CompanyResearchReferenceItem[],
  filterId: string,
) {
  if (filterId === "all") {
    return references;
  }

  if (filterId === "first_party" || filterId === "third_party") {
    return references.filter((item) => item.sourceTier === filterId);
  }

  return references.filter((item) => item.sourceType === filterId);
}

function readFirstString(
  value: Record<string, unknown>,
  keys: string[],
  fallback: string,
) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return fallback;
}

function normalizeConceptCards(value: unknown): CompanyResearchConceptCard[] {
  const sourceItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.concept_insights)
      ? value.concept_insights
      : [];

  return sourceItems.filter(isRecord).map((item, index) => ({
    id: `concept-${index + 1}`,
    concept: readFirstString(item, ["concept"], `概念 ${index + 1}`),
    whyItMatters: readFirstString(
      item,
      ["whyItMatters", "why_it_matters", "insight"],
      "旧版结果未提供概念洞察说明。",
    ),
    companyFit: readFirstString(
      item,
      ["companyFit", "company_fit"],
      "旧版结果未单独提供公司契合点。",
    ),
    monetizationPath: readFirstString(
      item,
      ["monetizationPath", "monetization_path"],
      "旧版结果未单独提供变现路径。",
    ),
    maturity: readFirstString(
      item,
      ["maturity", "research_priority"],
      "待补充",
    ),
  }));
}

function extractInputSnapshot(input: unknown) {
  if (!isRecord(input)) {
    return {
      companyName: undefined,
      stockCode: undefined,
      researchGoal: undefined,
      focusConcepts: [] as string[],
    };
  }

  const researchPreferences = isRecord(input.researchPreferences)
    ? input.researchPreferences
    : {};

  return {
    companyName:
      typeof input.companyName === "string" ? input.companyName : undefined,
    stockCode:
      typeof input.stockCode === "string" ? input.stockCode : undefined,
    researchGoal:
      typeof researchPreferences.researchGoal === "string"
        ? researchPreferences.researchGoal
        : undefined,
    focusConcepts: toStringList(input.focusConcepts),
  };
}

export function buildCompanyResearchDetailModel(params: {
  status?: string;
  result?: unknown;
  input?: unknown;
  currentNodeKey?: string | null;
}): CompanyResearchDetailPageModel | null {
  if (isCompanyResearchResult(params.result)) {
    const result = params.result;
    const digest = buildResearchDigest({
      templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      query: result.brief.companyName,
      status: params.status,
      result,
    });

    return {
      kind: "detail",
      backgroundItems: buildBackgroundItemsFromBrief({
        companyName: result.brief.companyName,
        stockCode: result.brief.stockCode,
        researchGoal: result.brief.researchGoal,
        focusConcepts: result.brief.focusConcepts,
        status: params.status,
        generatedAt: result.generatedAt,
      }),
      digest,
      confidenceSummary: findConfidenceSummary(
        extractConfidenceAnalysis(result),
      ),
      conceptCards: normalizeConceptCards(result.conceptInsights),
      questionCards: buildQuestionCards(result),
      referenceFilters: buildReferenceFilters(result.references),
      collectors: result.collectionSummary.collectors,
      references: result.references,
      referenceStats: [
        {
          label: "原始证据",
          value: String(result.collectionSummary.totalRawCount),
        },
        {
          label: "入选证据",
          value: String(result.collectionSummary.totalCuratedCount),
        },
        {
          label: "引用数",
          value: String(result.collectionSummary.totalReferenceCount),
        },
        {
          label: "一手信源",
          value: String(result.collectionSummary.totalFirstPartyCount),
        },
      ],
    };
  }

  if (params.status !== "PAUSED") {
    return null;
  }

  const inputSnapshot = extractInputSnapshot(params.input);
  const resultRecord = isRecord(params.result) ? params.result : {};
  const blockers = uniqueList([
    ...toStringList(resultRecord.missingRequirements).map((item) =>
      formatRuntimeIssueLabel(item),
    ),
    ...toStringList(resultRecord.qualityFlags).map((item) =>
      formatRuntimeIssueLabel(item),
    ),
  ]);

  return {
    kind: "paused_fallback",
    backgroundItems: buildBackgroundItemsFromBrief({
      companyName: inputSnapshot.companyName,
      stockCode: inputSnapshot.stockCode,
      researchGoal: inputSnapshot.researchGoal,
      focusConcepts: inputSnapshot.focusConcepts,
      status: params.status,
      generatedAt: null,
    }),
    blockers:
      blockers.length > 0 ? blockers : ["当前任务已暂停，等待补充信息后继续。"],
    nextActions: uniqueList([
      params.currentNodeKey
        ? `当前暂停节点：${formatWorkflowNodeLabel(params.currentNodeKey)}`
        : undefined,
      "补齐缺失信息后继续研究",
      "回到公司研究页调整输入范围",
    ]),
  };
}

function SummaryMetricRow(props: {
  items: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {props.items.map((item) => (
        <div
          key={item.label}
          className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3"
        >
          <div className="text-xs text-[var(--app-text-soft)]">
            {item.label}
          </div>
          <div className="app-data mt-2 text-lg text-[var(--app-text)]">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryTab(props: { model: CompanyResearchDetailModel }) {
  const confidenceToneValue = confidenceTone(
    props.model.confidenceSummary.level,
  );

  return (
    <div className="grid gap-6">
      <Panel
        title="结论摘要"
        description={
          <MarkdownContent content={props.model.digest.summary} compact />
        }
        actions={
          <StatusPill
            label={props.model.digest.verdictLabel}
            tone={props.model.digest.verdictTone}
          />
        }
      >
        <SummaryMetricRow items={props.model.digest.metrics.slice(0, 4)} />
      </Panel>

      <Panel
        title="可信度摘要"
        description="保留摘要层，不在主详情页展开逐条断言审核。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">
              可信度得分
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {props.model.confidenceSummary.score}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">等级</div>
            <div className="mt-2 flex items-center gap-2 text-[var(--app-text)]">
              <span className="app-data text-lg">
                {props.model.confidenceSummary.level}
              </span>
              <StatusPill
                label={props.model.confidenceSummary.level}
                tone={confidenceToneValue}
              />
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">
              证据覆盖率
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {props.model.confidenceSummary.coverage}
            </div>
          </div>
        </div>

        {props.model.confidenceSummary.notes.length > 0 ? (
          <div className="mt-4 grid gap-2">
            {props.model.confidenceSummary.notes.map((item) => (
              <div
                key={item}
                className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-3 py-2 text-sm leading-6 text-[var(--app-text-muted)]"
              >
                {item}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <KeyPointList
          title="看多逻辑"
          items={props.model.digest.bullPoints.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂无结构化看多逻辑。"
          tone="success"
        />
        <KeyPointList
          title="风险点"
          items={props.model.digest.bearPoints.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂无结构化风险提示。"
          tone="warning"
        />
        <KeyPointList
          title="下一步动作"
          items={
            props.model.digest.nextActions.length > 0
              ? props.model.digest.nextActions.map((item) => (
                  <MarkdownContent key={item} content={item} compact />
                ))
              : props.model.digest.gaps.map((item) => (
                  <MarkdownContent key={item} content={item} compact />
                ))
          }
          emptyText="暂无后续动作。"
          tone="info"
        />
      </div>
    </div>
  );
}

function ConceptsTab(props: { model: CompanyResearchDetailModel }) {
  if (props.model.conceptCards.length === 0) {
    return (
      <EmptyState
        title="暂无业务与概念卡片"
        description="这次研究没有产出结构化概念洞察。"
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {props.model.conceptCards.map((item) => (
        <Panel
          key={item.id}
          title={item.concept}
          description={<MarkdownContent content={item.whyItMatters} compact />}
          actions={<StatusPill label={item.maturity} tone="info" />}
        >
          <div className="grid gap-4">
            <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                公司契合点
              </div>
              <MarkdownContent
                content={item.companyFit}
                compact
                className="mt-2"
              />
            </div>
            <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                变现路径
              </div>
              <MarkdownContent
                content={item.monetizationPath}
                compact
                className="mt-2"
              />
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function QuestionsTab(props: {
  model: CompanyResearchDetailModel;
  expandedQuestionId: string | null;
  onQuestionToggle?: (questionId: string) => void;
}) {
  if (props.model.questionCards.length === 0) {
    return (
      <EmptyState
        title="暂无关键问题卡片"
        description="这次研究没有产出可展开的问题答案。"
      />
    );
  }

  return (
    <div className="grid gap-3">
      {props.model.questionCards.map((item) => {
        const expanded = item.id === props.expandedQuestionId;
        return (
          <article
            key={item.id}
            className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-surface)]"
          >
            <button
              type="button"
              onClick={() => props.onQuestionToggle?.(item.id)}
              className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--app-bg-floating)]"
            >
              <div className="min-w-0">
                <div className="text-base text-[var(--app-text-strong)]">
                  {item.question}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusPill
                    label={`置信度 ${formatConfidenceLevel(item.confidence)}`}
                    tone={confidenceTone(item.confidence)}
                  />
                  <StatusPill
                    label={`引用 ${item.referenceCount}`}
                    tone="neutral"
                  />
                  <StatusPill label={`缺口 ${item.gapCount}`} tone="warning" />
                </div>
              </div>
              <span className="text-sm text-[var(--app-text-soft)]">
                {expanded ? "收起" : "展开"}
              </span>
            </button>

            {expanded ? (
              <div className="grid gap-4 border-t border-[var(--app-border-soft)] px-5 py-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      为什么重要
                    </div>
                    <MarkdownContent
                      content={item.whyImportant}
                      compact
                      className="mt-2"
                    />
                  </div>
                  <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      目标指标
                    </div>
                    <MarkdownContent
                      content={item.targetMetric}
                      compact
                      className="mt-2"
                    />
                  </div>
                  <div className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
                    <div className="text-xs text-[var(--app-text-soft)]">
                      数据提示
                    </div>
                    <MarkdownContent
                      content={item.dataHint}
                      compact
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4">
                  <div className="text-xs text-[var(--app-text-soft)]">
                    当前答案
                  </div>
                  <MarkdownContent content={item.answer} className="mt-2" />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Panel title="支持引用预览" surface="inset" density="compact">
                    {item.referencePreview.length === 0 ? (
                      <div className="text-sm leading-6 text-[var(--app-text-subtle)]">
                        暂无引用预览。
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {item.referencePreview.map((reference) => (
                          <div
                            key={reference.id}
                            className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill
                                label={formatSourceTypeLabel(
                                  reference.sourceType,
                                )}
                                tone="neutral"
                              />
                              <StatusPill
                                label={formatSourceTierLabel(
                                  reference.sourceTier,
                                )}
                                tone={
                                  reference.sourceTier === "first_party"
                                    ? "success"
                                    : "neutral"
                                }
                              />
                              {reference.url ? (
                                <Link
                                  href={reference.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-[var(--app-accent-strong)] hover:underline"
                                >
                                  {reference.title}
                                </Link>
                              ) : (
                                <span className="text-sm text-[var(--app-text)]">
                                  {reference.title}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                              {reference.extractedFact}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>

                  <KeyPointList
                    title="待补缺口"
                    items={item.gaps.map((gap) => (
                      <MarkdownContent key={gap} content={gap} compact />
                    ))}
                    emptyText="当前问题没有待补缺口。"
                    tone="warning"
                  />
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function ReferencesTab(props: {
  model: CompanyResearchDetailModel;
  referenceFilterId: string;
  onReferenceFilterChange?: (filterId: string) => void;
}) {
  const filteredReferences = filterReferences(
    props.model.references,
    props.referenceFilterId,
  );

  return (
    <div className="grid gap-6">
      <Panel
        title="证据覆盖"
        description="先看本次公司研究用了多少证据，再下钻到具体引用。"
      >
        <SummaryMetricRow items={props.model.referenceStats} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel
          title="来源浏览"
          description="按来源类型或信源层级切换引用列表。"
        >
          <div className="flex flex-wrap gap-2">
            {props.model.referenceFilters.map((item) => {
              const active = item.id === props.referenceFilterId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => props.onReferenceFilterChange?.(item.id)}
                  className={
                    active
                      ? "rounded-[10px] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text-strong)]"
                      : "rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-sm text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
                  }
                >
                  {item.label} {item.count}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3">
            {props.model.collectors.map((collector) => (
              <div
                key={collector.collectorKey}
                className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-[var(--app-text)]">
                    {collector.label}
                  </div>
                  <StatusPill
                    label={collector.configured ? "已启用" : "已跳过"}
                    tone={collector.configured ? "info" : "warning"}
                  />
                </div>
                <div className="mt-2 text-xs leading-6 text-[var(--app-text-muted)]">
                  原始 {collector.rawCount} / 入选 {collector.curatedCount} /
                  一手 {collector.firstPartyCount}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="引用列表"
          description="展示提取事实、原文片段和来源链接。"
        >
          {filteredReferences.length === 0 ? (
            <EmptyState
              title="当前筛选下暂无引用"
              description="可以切换其他来源类型继续查看。"
            />
          ) : (
            <div className="grid gap-3">
              {filteredReferences.map((reference) => (
                <article
                  key={reference.id}
                  className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={formatSourceTypeLabel(reference.sourceType)}
                      tone="neutral"
                    />
                    <StatusPill
                      label={formatSourceTierLabel(reference.sourceTier)}
                      tone={
                        reference.sourceTier === "first_party"
                          ? "success"
                          : "neutral"
                      }
                    />
                    {reference.url ? (
                      <Link
                        href={reference.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[var(--app-accent-strong)] hover:underline"
                      >
                        {reference.title}
                      </Link>
                    ) : (
                      <span className="text-sm text-[var(--app-text)]">
                        {reference.title}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-[var(--app-text-soft)]">
                    {reference.sourceName}
                    {reference.publishedAt ? ` · ${reference.publishedAt}` : ""}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--app-text)]">
                    {reference.extractedFact}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    {reference.snippet}
                  </p>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function CompanyResearchDetailPanels(props: {
  model: CompanyResearchDetailModel;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  expandedQuestionId?: string | null;
  onQuestionToggle?: (questionId: string) => void;
  referenceFilterId?: string;
  onReferenceFilterChange?: (filterId: string) => void;
}) {
  const activeTabId =
    props.activeTabId ?? companyResearchDetailTabs[0]?.id ?? "summary";
  const expandedQuestionId =
    props.expandedQuestionId ?? props.model.questionCards[0]?.id ?? null;
  const referenceFilterId = props.referenceFilterId ?? "all";

  return (
    <WorkflowStageSwitcher
      tabs={companyResearchDetailTabs}
      activeTabId={activeTabId}
      onChange={props.onTabChange}
      panels={{
        summary: <SummaryTab model={props.model} />,
        concepts: <ConceptsTab model={props.model} />,
        questions: (
          <QuestionsTab
            model={props.model}
            expandedQuestionId={expandedQuestionId}
            onQuestionToggle={props.onQuestionToggle}
          />
        ),
        references: (
          <ReferencesTab
            model={props.model}
            referenceFilterId={referenceFilterId}
            onReferenceFilterChange={props.onReferenceFilterChange}
          />
        ),
      }}
    />
  );
}

export function CompanyResearchDetailContent(props: {
  model: CompanyResearchDetailModel;
}) {
  const [activeTabId, setActiveTabId] = useState(
    companyResearchDetailTabs[0]?.id ?? "summary",
  );
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(
    props.model.questionCards[0]?.id ?? null,
  );
  const [referenceFilterId, setReferenceFilterId] = useState("all");

  const stableExpandedQuestionId = useMemo(() => {
    if (
      expandedQuestionId &&
      props.model.questionCards.some((item) => item.id === expandedQuestionId)
    ) {
      return expandedQuestionId;
    }

    return props.model.questionCards[0]?.id ?? null;
  }, [expandedQuestionId, props.model.questionCards]);

  return (
    <div className="grid gap-6">
      <CompanyResearchDetailPanels
        model={props.model}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        expandedQuestionId={stableExpandedQuestionId}
        onQuestionToggle={(questionId) =>
          setExpandedQuestionId((current) =>
            current === questionId ? null : questionId,
          )
        }
        referenceFilterId={referenceFilterId}
        onReferenceFilterChange={setReferenceFilterId}
      />
    </div>
  );
}

export function CompanyResearchPausedFallbackPanel(props: {
  model: CompanyResearchPausedFallbackModel;
}) {
  return (
    <div className="grid gap-6">
      <Panel
        title="已暂停"
        description="当前还没有完整的结构化公司研究结果，先处理暂停原因再继续。"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <KeyPointList
            title="当前阻塞项"
            items={props.model.blockers.map((item) => (
              <MarkdownContent key={item} content={item} compact />
            ))}
            emptyText="暂无阻塞项。"
            tone="warning"
          />
          <KeyPointList
            title="建议动作"
            items={props.model.nextActions.map((item) => (
              <MarkdownContent key={item} content={item} compact />
            ))}
            emptyText="暂无建议动作。"
            tone="info"
          />
        </div>
      </Panel>
    </div>
  );
}
