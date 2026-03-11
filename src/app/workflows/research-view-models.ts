import type { ConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  type CompanyResearchResultDto,
  QUICK_RESEARCH_TEMPLATE_CODE,
  type QuickResearchResultDto,
} from "~/server/domain/workflow/types";

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
      result.evidence.map((item) => `${item.title}: ${item.extractedFact}`),
      4,
    ),
    gaps: uniqueList(
      result.findings.flatMap((item) => item.gaps),
      4,
    ),
    nextActions: uniqueList(result.verdict.nextChecks, 4),
    metrics: [
      ...buildConfidenceMetrics(result.confidenceAnalysis),
      { label: "证据条数", value: String(result.evidence.length) },
      { label: "高置信回答", value: String(highConfidenceCount) },
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
          ? `当前正在处理: ${params.currentNodeKey}`
          : "研究正在生成中，稍后可查看正式结论。",
      bullPoints: [],
      bearPoints: [],
      evidence: [],
      gaps: [],
      nextActions: [`等待本次研究完成: ${params.progressPercent ?? 0}%`],
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
      nextActions: ["检查输入是否过宽或缺失关键上下文"],
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
      return buildQuickResearchDigest(params.result);
    }
  }

  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    if (isCompanyResearchResult(params.result)) {
      return buildCompanyResearchDigest(params.result);
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
