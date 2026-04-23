import type { ConfidenceAnalysis } from "~/modules/research/server/domain/intelligence/confidence";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  type CompanyResearchResultDto,
  QUICK_RESEARCH_TEMPLATE_CODE,
  type QuickResearchResultDto,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import { formatWorkflowNodeLabel } from "~/modules/research/ui/industry/detail-labels";

export type InvestorTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type ResearchDigest = {
  templateLabel: string;
  verdictLabel: string;
  verdictTone: InvestorTone;
  headline: string;
  summary: string;
  bullPoints: string[];
  bearPoints: string[];
  evidence: string[];
  gaps: string[];
  nextActions: string[];
  metrics: Array<{
    label: string;
    value: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstSentence(value: string | undefined): string {
  if (!value) {
    return "暂无结论";
  }

  const sentence = value.split(/[。！？!?]/)[0]?.trim();
  return sentence && sentence.length > 0 ? sentence : value;
}

function uniqueList(items: Array<string | null | undefined>, limit = 4) {
  return [
    ...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]),
  ].slice(0, limit);
}

function formatPercent(value: number) {
  return `${value.toFixed(0)}%`;
}

function formatNumber(value: number | undefined, fractionDigits = 0) {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return value.toFixed(fractionDigits);
}

function formatPct(value: number | undefined, fractionDigits = 1) {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${value.toFixed(fractionDigits)}%`;
}

function formatConfidenceScore(analysis?: ConfidenceAnalysis | null) {
  if (!analysis || analysis.finalScore === null) {
    return "未分析";
  }

  return `${analysis.finalScore}`;
}

function formatConfidenceLevel(analysis?: ConfidenceAnalysis | null) {
  if (!analysis) {
    return "未知";
  }

  switch (analysis.level) {
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

function buildConfidenceMetrics(
  analysis?: ConfidenceAnalysis | null,
): Array<{ label: string; value: string }> {
  if (!analysis) {
    return [{ label: "可信度", value: "未分析" }];
  }

  return [
    { label: "可信度", value: formatConfidenceScore(analysis) },
    { label: "可信等级", value: formatConfidenceLevel(analysis) },
    {
      label: "支持/不足/冲突",
      value: `${analysis.supportedCount}/${analysis.insufficientCount}/${analysis.contradictedCount}`,
    },
    {
      label: "证据覆盖率",
      value: `${analysis.evidenceCoverageScore}%`,
    },
  ];
}

export function getTemplateLabel(templateCode?: string) {
  switch (templateCode) {
    case QUICK_RESEARCH_TEMPLATE_CODE:
      return "行业判断";
    case COMPANY_RESEARCH_TEMPLATE_CODE:
      return "公司判断";
    default:
      return "研究判断";
  }
}

export function isQuickResearchResult(
  value: unknown,
): value is QuickResearchResultDto {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.overview === "string" &&
    typeof value.heatScore === "number" &&
    typeof value.heatConclusion === "string" &&
    Array.isArray(value.topPicks)
  );
}

export function getQuickResearchModePills(
  result: unknown,
  input?: unknown,
): string[] {
  let requestedDepth: "standard" | "deep" | undefined;
  let autoEscalated = false;

  if (isQuickResearchResult(result)) {
    requestedDepth = result.requestedDepth ?? "standard";
    autoEscalated = Boolean(result.autoEscalated);
  } else if (isRecord(input) && isRecord(input.taskContract)) {
    requestedDepth =
      input.taskContract.analysisDepth === "deep" ? "deep" : "standard";
  }

  if (!requestedDepth) {
    return [];
  }

  const pills = [requestedDepth === "deep" ? "深度模式" : "标准模式"];

  if (autoEscalated) {
    pills.push("已自动升级");
  }

  return pills;
}

export function isCompanyResearchResult(
  value: unknown,
): value is CompanyResearchResultDto {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.brief) &&
    isRecord(value.verdict) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.evidence)
  );
}

function buildQuickResearchDigest(
  result: QuickResearchResultDto,
): ResearchDigest {
  const topPicks = result.topPicks.slice(0, 3);
  const credibilityHighlights = result.credibility.flatMap(
    (item) => item.highlights,
  );
  const credibilityRisks = result.credibility.flatMap((item) => item.risks);

  return {
    templateLabel: "行业判断",
    verdictLabel:
      result.heatScore >= 70
        ? "高热度赛道"
        : result.heatScore >= 45
          ? "持续跟踪"
          : "热度一般",
    verdictTone:
      result.heatScore >= 70
        ? "success"
        : result.heatScore >= 45
          ? "info"
          : "warning",
    headline: firstSentence(result.heatConclusion),
    summary: result.overview,
    bullPoints: uniqueList(
      topPicks.map((item) => `${item.stockName}: ${item.reason}`),
      3,
    ),
    bearPoints: uniqueList([...credibilityRisks, result.competitionSummary], 3),
    evidence: uniqueList(
      [
        ...credibilityHighlights,
        ...result.candidates.map((item) => item.reason),
      ],
      4,
    ),
    gaps: [],
    nextActions: uniqueList(
      topPicks.map((item) => `转入公司判断: ${item.stockName}`),
      3,
    ),
    metrics: [
      ...(typeof result.contractScore === "number"
        ? [{ label: "合同得分", value: formatNumber(result.contractScore) }]
        : []),
      ...buildConfidenceMetrics(result.confidenceAnalysis),
      { label: "赛道热度", value: formatPercent(result.heatScore) },
      { label: "候选标的", value: String(result.candidates.length) },
      { label: "重点标的", value: String(result.topPicks.length) },
    ],
  };
}

function buildCompanyResearchDigest(
  result: CompanyResearchResultDto,
): ResearchDigest {
  const gapCount = result.findings.reduce(
    (count, item) => count + item.gaps.length,
    0,
  );
  const highConfidenceCount = result.findings.filter(
    (item) => item.confidence === "high",
  ).length;
  const firstPartyCount =
    result.collectionSummary?.totalFirstPartyCount ??
    result.evidence.filter((item) => item.isFirstParty).length;
  const referenceCount = result.references?.length ?? result.evidence.length;

  return {
    templateLabel: "公司判断",
    verdictLabel: result.verdict.stance,
    verdictTone:
      result.verdict.stance === "优先研究"
        ? "success"
        : result.verdict.stance === "继续跟踪"
          ? "info"
          : "warning",
    headline: firstSentence(result.verdict.summary),
    summary: result.verdict.summary,
    bullPoints: uniqueList(result.verdict.bullPoints, 4),
    bearPoints: uniqueList(result.verdict.bearPoints, 4),
    evidence: uniqueList(
      result.evidence.map(
        (item) =>
          `${item.isFirstParty ? "[一手]" : "[外部]"} ${item.title}: ${item.extractedFact}`,
      ),
      4,
    ),
    gaps: uniqueList(
      result.findings.flatMap((item) => item.gaps),
      4,
    ),
    nextActions: uniqueList(result.verdict.nextChecks, 4),
    metrics: [
      ...(typeof result.contractScore === "number"
        ? [{ label: "合同得分", value: formatNumber(result.contractScore) }]
        : []),
      ...buildConfidenceMetrics(result.confidenceAnalysis),
      { label: "证据条数", value: String(result.evidence.length) },
      { label: "引用数量", value: String(referenceCount) },
      { label: "一手信源", value: String(firstPartyCount) },
      { label: "高信度回答", value: String(highConfidenceCount) },
      { label: "待核验缺口", value: String(gapCount) },
      { label: "重点概念", value: String(result.brief.focusConcepts.length) },
    ],
  };
}

function buildGenericDigest(params: {
  query?: string;
  status?: string;
  progressPercent?: number;
  currentNodeKey?: string | null;
  result?: unknown;
  templateCode?: string;
}): ResearchDigest {
  const templateLabel = getTemplateLabel(params.templateCode);

  if (params.status === "RUNNING" || params.status === "PENDING") {
    return {
      templateLabel,
      verdictLabel: params.status === "RUNNING" ? "进行中" : "等待执行",
      verdictTone: params.status === "RUNNING" ? "info" : "warning",
      headline: firstSentence(params.query),
      summary:
        params.currentNodeKey && params.currentNodeKey.length > 0
          ? `当前正在处理：${formatWorkflowNodeLabel(params.currentNodeKey)}`
          : "研究正在生成中，稍后可查看正式结论。",
      bullPoints: [],
      bearPoints: [],
      evidence: [],
      gaps: [],
      nextActions: [`等待本次研究完成：${params.progressPercent ?? 0}%`],
      metrics: [
        { label: "当前进度", value: `${params.progressPercent ?? 0}%` },
      ],
    };
  }

  if (params.status === "PAUSED") {
    return {
      templateLabel,
      verdictLabel: "待处理",
      verdictTone: "warning",
      headline: firstSentence(params.query),
      summary:
        params.currentNodeKey && params.currentNodeKey.length > 0
          ? `任务暂停于 ${formatWorkflowNodeLabel(params.currentNodeKey)}，需要补充信息或人工审批后继续。`
          : "任务已暂停，等待补充信息或人工审批。",
      bullPoints: [],
      bearPoints: [],
      evidence: [],
      gaps: ["补充必要信息或完成审批后，才能继续执行剩余节点。"],
      nextActions: ["补充信息或审批后继续"],
      metrics: [
        { label: "当前进度", value: `${params.progressPercent ?? 0}%` },
      ],
    };
  }

  if (params.status === "FAILED") {
    return {
      templateLabel,
      verdictLabel: "需要重跑",
      verdictTone: "danger",
      headline: firstSentence(params.query),
      summary: "这次研究未成功完成，建议调整输入范围后重新发起。",
      bullPoints: [],
      bearPoints: ["本次结果未完整生成"],
      evidence: [],
      gaps: ["需要重新运行以获取正式结论"],
      nextActions: ["检查输入是否过宽或缺少关键上下文"],
      metrics: [],
    };
  }

  const objectEntries = isRecord(params.result)
    ? Object.entries(params.result)
        .filter(([, value]) => typeof value === "string")
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${value as string}`)
    : [];

  return {
    templateLabel,
    verdictLabel: params.status === "SUCCEEDED" ? "已生成结论" : "查看详情",
    verdictTone: params.status === "SUCCEEDED" ? "success" : "neutral",
    headline: firstSentence(params.query),
    summary:
      objectEntries[0] ?? "当前结果可查看，但尚未整理为专门的投资结论摘要。",
    bullPoints: [],
    bearPoints: [],
    evidence: objectEntries,
    gaps: [],
    nextActions: ["进入详情页查看完整结论与调试信息"],
    metrics: isRecord(params.result)
      ? [
          {
            label: "结果字段",
            value: String(Object.keys(params.result).length),
          },
        ]
      : [],
  };
}

const timingDigestTemplateLabelMap: Record<string, string> = {
  [TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE]: "单股择时",
  [WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE]: "批量信号",
  [WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE]: "组合建议",
  [TIMING_REVIEW_LOOP_TEMPLATE_CODE]: "择时复盘",
};

const timingActionLabelMap: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const timingMarketLabelMap: Record<string, string> = {
  RISK_ON: "风险偏好",
  NEUTRAL: "中性环境",
  RISK_OFF: "防守环境",
};

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function buildTimingWorkflowDigest(params: {
  templateCode?: string;
  query?: string;
  status?: string;
  progressPercent?: number;
  currentNodeKey?: string | null;
  result?: unknown;
}): ResearchDigest | null {
  if (!params.templateCode || !isRecord(params.result)) {
    return null;
  }

  const templateLabel =
    timingDigestTemplateLabelMap[params.templateCode] ??
    getTemplateLabel(params.templateCode);

  const recommendations = asRecordArray(params.result.persistedRecommendations);
  if (recommendations.length > 0) {
    const firstRecommendation = recommendations[0];
    if (!firstRecommendation) {
      return null;
    }

    const firstReasoning = isRecord(firstRecommendation.reasoning)
      ? firstRecommendation.reasoning
      : null;
    const marketContext =
      firstReasoning && isRecord(firstReasoning.marketContext)
        ? firstReasoning.marketContext
        : null;
    const riskPlan =
      firstReasoning && isRecord(firstReasoning.riskPlan)
        ? firstReasoning.riskPlan
        : null;
    const recommendationItems = recommendations.slice(0, 4).map((item) => {
      const action =
        typeof item.action === "string"
          ? (timingActionLabelMap[item.action] ?? item.action)
          : "观察";
      const stockName =
        typeof item.stockName === "string"
          ? item.stockName
          : typeof item.stockCode === "string"
            ? item.stockCode
            : "未命名标的";
      const minPct =
        typeof item.suggestedMinPct === "number"
          ? formatPct(item.suggestedMinPct)
          : "-";
      const maxPct =
        typeof item.suggestedMaxPct === "number"
          ? formatPct(item.suggestedMaxPct)
          : "-";

      return `${stockName}: ${action} ${minPct}-${maxPct}`;
    });
    const riskNotes = Array.isArray(riskPlan?.notes)
      ? riskPlan.notes.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const riskFlags = recommendations.flatMap((item) =>
      Array.isArray(item.riskFlags)
        ? item.riskFlags.filter(
            (flag): flag is string => typeof flag === "string",
          )
        : [],
    );
    const highestConfidence = recommendations.reduce((highest, item) => {
      const confidence =
        typeof item.confidence === "number" ? item.confidence : 0;
      return Math.max(highest, confidence);
    }, 0);
    const riskBudget =
      typeof firstRecommendation.riskBudgetPct === "number"
        ? firstRecommendation.riskBudgetPct
        : undefined;
    const actionRationale =
      firstReasoning && typeof firstReasoning.actionRationale === "string"
        ? firstReasoning.actionRationale
        : undefined;
    const marketState =
      typeof firstRecommendation.marketState === "string"
        ? firstRecommendation.marketState
        : undefined;

    return {
      templateLabel,
      verdictLabel: "组合建议已生成",
      verdictTone: "success",
      headline: firstSentence(params.query),
      summary:
        actionRationale ??
        (marketContext && typeof marketContext.summary === "string"
          ? marketContext.summary
          : `本次共生成 ${recommendations.length} 条组合建议，可继续筛选优先级更高的标的。`),
      bullPoints: uniqueList(recommendationItems, 4),
      bearPoints: uniqueList(riskFlags, 4),
      evidence: uniqueList(
        [
          marketContext && typeof marketContext.summary === "string"
            ? marketContext.summary
            : undefined,
          ...riskNotes,
        ],
        4,
      ),
      gaps: [],
      nextActions: uniqueList(riskNotes, 4),
      metrics: [
        { label: "建议数量", value: String(recommendations.length) },
        { label: "最高信心", value: formatNumber(highestConfidence) },
        { label: "风险预算", value: formatPct(riskBudget) },
        {
          label: "市场环境",
          value: marketState
            ? (timingMarketLabelMap[marketState] ?? marketState)
            : "-",
        },
      ],
    };
  }

  const cards = asRecordArray(params.result.persistedCards);
  if (cards.length > 0) {
    const firstCard = cards[0];
    if (!firstCard) {
      return null;
    }

    const actionBias =
      typeof firstCard.actionBias === "string"
        ? (timingActionLabelMap[firstCard.actionBias] ?? firstCard.actionBias)
        : "观察";
    const summaries = cards
      .map((item) =>
        typeof item.summary === "string" ? item.summary : undefined,
      )
      .filter(Boolean) as string[];
    const triggerNotes = cards.flatMap((item) =>
      Array.isArray(item.triggerNotes)
        ? item.triggerNotes.filter(
            (note): note is string => typeof note === "string",
          )
        : [],
    );
    const invalidationNotes = cards.flatMap((item) =>
      Array.isArray(item.invalidationNotes)
        ? item.invalidationNotes.filter(
            (note): note is string => typeof note === "string",
          )
        : [],
    );
    const distinctStocks = new Set(
      cards
        .map((item) =>
          typeof item.stockCode === "string" ? item.stockCode : undefined,
        )
        .filter(Boolean),
    ).size;
    const highestConfidence = cards.reduce((highest, item) => {
      const confidence =
        typeof item.confidence === "number" ? item.confidence : 0;
      return Math.max(highest, confidence);
    }, 0);

    return {
      templateLabel,
      verdictLabel: `${actionBias}信号`,
      verdictTone: actionBias === "加仓" ? "success" : "info",
      headline: firstSentence(params.query),
      summary:
        summaries[0] ??
        `本次共生成 ${cards.length} 张择时信号卡，可按信心和动作倾向继续筛选。`,
      bullPoints: uniqueList(
        triggerNotes.length > 0 ? triggerNotes : summaries,
        4,
      ),
      bearPoints: uniqueList(invalidationNotes, 4),
      evidence: uniqueList(summaries, 4),
      gaps: [],
      nextActions: uniqueList(
        cards.slice(0, 4).map((item) => {
          const stockName =
            typeof item.stockName === "string"
              ? item.stockName
              : typeof item.stockCode === "string"
                ? item.stockCode
                : "未命名标的";
          return `查看 ${stockName} 的信号细节`;
        }),
        4,
      ),
      metrics: [
        { label: "信号卡数", value: String(cards.length) },
        { label: "覆盖标的", value: String(distinctStocks) },
        { label: "最高信心", value: formatNumber(highestConfidence) },
        { label: "主要动作", value: actionBias },
      ],
    };
  }

  const reviews = asRecordArray(params.result.persistedReviews);
  if (reviews.length > 0) {
    const reviewSummaries = reviews
      .map((item) =>
        typeof item.reviewSummary === "string" ? item.reviewSummary : undefined,
      )
      .filter(Boolean) as string[];
    const successCount = reviews.filter(
      (item) => item.verdict === "SUCCESS",
    ).length;
    const failureCount = reviews.filter(
      (item) => item.verdict === "FAILURE",
    ).length;
    const mixedCount = reviews.filter(
      (item) => item.verdict === "MIXED",
    ).length;

    return {
      templateLabel,
      verdictLabel: "复盘结果已更新",
      verdictTone: successCount >= failureCount ? "success" : "warning",
      headline: firstSentence(params.query),
      summary:
        reviewSummaries[0] ??
        `本次共完成 ${reviews.length} 条择时复盘，可用于回看策略与阈值是否需要调整。`,
      bullPoints: uniqueList(
        reviews
          .filter((item) => item.verdict === "SUCCESS")
          .map((item) => {
            const stockName =
              typeof item.stockName === "string"
                ? item.stockName
                : typeof item.stockCode === "string"
                  ? item.stockCode
                  : "未命名标的";
            return `${stockName}: 验证通过`;
          }),
        4,
      ),
      bearPoints: uniqueList(
        reviews
          .filter((item) => item.verdict === "FAILURE")
          .map((item) => {
            const stockName =
              typeof item.stockName === "string"
                ? item.stockName
                : typeof item.stockCode === "string"
                  ? item.stockCode
                  : "未命名标的";
            return `${stockName}: 复盘偏弱`;
          }),
        4,
      ),
      evidence: uniqueList(reviewSummaries, 4),
      gaps: [],
      nextActions: uniqueList(reviewSummaries, 4),
      metrics: [
        { label: "复盘条数", value: String(reviews.length) },
        { label: "验证通过", value: String(successCount) },
        { label: "表现一般", value: String(mixedCount) },
        { label: "验证失败", value: String(failureCount) },
      ],
    };
  }

  return null;
}

function buildQuickResearchClarificationDigest(
  result: QuickResearchResultDto,
): ResearchDigest {
  const base = buildQuickResearchDigest(result);
  const clarificationSummary = result.brief?.clarificationSummary?.trim();

  return {
    ...base,
    verdictLabel: "范围较宽",
    verdictTone: "warning",
    summary: clarificationSummary
      ? `${base.summary} 当前按较宽范围继续执行：${clarificationSummary}`
      : base.summary,
    gaps: uniqueList(
      result.clarificationRequest?.missingScopeFields?.map(String) ?? [],
      4,
    ),
    nextActions: uniqueList(["补充范围后重新发起", ...base.nextActions], 4),
  };
}

export function buildResearchDigest(params: {
  templateCode?: string;
  query?: string;
  status?: string;
  progressPercent?: number;
  currentNodeKey?: string | null;
  result?: unknown;
}): ResearchDigest {
  if (params.templateCode === QUICK_RESEARCH_TEMPLATE_CODE) {
    if (isQuickResearchResult(params.result)) {
      if (params.result.clarificationRequest?.needClarification) {
        return buildQuickResearchClarificationDigest(params.result);
      }
      return buildQuickResearchDigest(params.result);
    }
  }

  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    if (isCompanyResearchResult(params.result)) {
      return buildCompanyResearchDigest(params.result);
    }
  }

  if (
    params.templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE ||
    params.templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE ||
    params.templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE ||
    params.templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
  ) {
    const timingDigest = buildTimingWorkflowDigest(params);

    if (timingDigest) {
      return timingDigest;
    }
  }

  return buildGenericDigest(params);
}

export function extractConfidenceAnalysis(
  result: unknown,
): ConfidenceAnalysis | null {
  if (isQuickResearchResult(result)) {
    return result.confidenceAnalysis ?? null;
  }

  if (isCompanyResearchResult(result)) {
    return result.confidenceAnalysis ?? null;
  }

  return null;
}

export function extractTimingReportCardIds(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.cardIds)) {
    return [];
  }

  return result.cardIds.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}
