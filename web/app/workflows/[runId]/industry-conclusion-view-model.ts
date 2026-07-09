import {
  buildResearchDigest,
  extractConfidenceAnalysis,
  getIndustryResearchModePills,
  type InvestorTone,
  isIndustryResearchResult,
} from "~/app/workflows/research-view-models";
import type { ConfidenceClaimAnalysis } from "~/server/domain/intelligence/confidence";
import { INDUSTRY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

export type IndustryConclusionSectionId =
  | "overview"
  | "logic"
  | "evidence"
  | "risks";

export type IndustryConclusionMetric = {
  label: string;
  value: string;
};

export type IndustryConclusionAction = {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
};

export type IndustryConclusionNotice = {
  title: string;
  description: string;
  tone: InvestorTone;
  actions: IndustryConclusionAction[];
};

export type IndustryConclusionSection = {
  id: IndustryConclusionSectionId;
  label: string;
  summary: string;
};

export type IndustryConclusionTopPick = {
  stockCode: string;
  stockName: string;
  reason: string;
  href: string;
};

export type IndustryConclusionClaim = Pick<
  ConfidenceClaimAnalysis,
  "claimId" | "claimText" | "label" | "explanation"
>;

export type IndustryConclusionViewModel = {
  query: string;
  generatedAtLabel: string;
  headline: string;
  summary: string;
  verdictLabel: string;
  verdictTone: InvestorTone;
  activeSectionId: IndustryConclusionSectionId;
  statusLabel: string;
  modePills: string[];
  metricStrip: IndustryConclusionMetric[];
  overviewPoints: string[];
  overviewActions: IndustryConclusionAction[];
  notices: IndustryConclusionNotice[];
  sections: IndustryConclusionSection[];
  logic: {
    fullReportMarkdown?: string;
    industryDrivers: string[];
    competitionSummary: string;
    topPicks: IndustryConclusionTopPick[];
  };
  evidence: {
    scoreLabel: string;
    levelLabel: string;
    coverageLabel: string;
    tripletLabel: string;
    notes: string[];
    qualityFlags: string[];
    missingRequirements: string[];
    claims: IndustryConclusionClaim[];
  };
  risks: {
    summary: string;
    missingAreas: string[];
    riskSignals: string[];
    unansweredQuestions: string[];
    nextActions: string[];
  };
};

const sections: IndustryConclusionSection[] = [
  {
    id: "overview",
    label: "总览",
    summary: "",
  },
  {
    id: "logic",
    label: "核心逻辑",
    summary: "",
  },
  {
    id: "evidence",
    label: "证据与可信度",
    summary: "",
  },
  {
    id: "risks",
    label: "风险与下一步",
    summary: "",
  },
];

const statusLabelMap: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  PAUSED: "已暂停",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

function uniqueList(items: Array<string | null | undefined>, limit = 8) {
  return [
    ...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]),
  ].slice(0, limit);
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function buildCompanyResearchHref(params: {
  stockName: string;
  stockCode: string;
  query?: string;
}) {
  const search = new URLSearchParams();
  search.set("companyName", params.stockName);
  search.set("stockCode", params.stockCode);
  if (params.query) {
    search.set("keyQuestion", params.query);
  }

  return `/company-research?${search.toString()}`;
}

function shouldHideIndustryConclusionText(value?: string | null) {
  const text = value?.trim();

  if (!text) {
    return true;
  }

  if (/^(Screened|Validated)\s+\d+\s+candidates\.$/.test(text)) {
    return true;
  }

  const normalized = text.toLowerCase();

  if (normalized.includes("heuristic fallback")) {
    return true;
  }

  if (normalized.includes("evidence is within 30 days")) {
    return true;
  }

  if (normalized.includes("only a single source")) {
    return true;
  }

  if (normalized.includes("evidence is sufficient for synthesis")) {
    return true;
  }

  return normalized.startsWith("industry research completed");
}

function cleanConclusionTextList(
  items: Array<string | null | undefined>,
  limit = 8,
) {
  return uniqueList(
    items.filter((item) => !shouldHideIndustryConclusionText(item)),
    limit,
  );
}

export function buildIndustryConclusionViewModel(params: {
  runId: string;
  query?: string;
  status?: string;
  input?: unknown;
  result?: unknown;
  timingReportCardIds?: string[];
}): IndustryConclusionViewModel | null {
  if (!isIndustryResearchResult(params.result)) {
    return null;
  }

  const result = params.result;
  const digest = buildResearchDigest({
    templateCode: INDUSTRY_RESEARCH_TEMPLATE_CODE,
    query: params.query,
    status: params.status,
    result,
  });
  const confidenceAnalysis = extractConfidenceAnalysis(result);
  const overviewPoints = uniqueList(
    [
      ...(result.compressedFindings?.highlights ?? []),
      ...digest.bullPoints,
      ...digest.evidence,
    ],
    4,
  );
  const visibleOverviewPoints = cleanConclusionTextList(overviewPoints, 4);
  const topPicks = result.topPicks.slice(0, 3).map((item) => ({
    stockCode: item.stockCode,
    stockName: item.stockName,
    reason: item.reason,
    href: buildCompanyResearchHref({
      stockName: item.stockName,
      stockCode: item.stockCode,
      query: params.query,
    }),
  }));
  const overviewActions: IndustryConclusionAction[] = [];

  if (topPicks[0]) {
    overviewActions.push({
      label: `继续看 ${topPicks[0].stockName}`,
      href: topPicks[0].href,
      variant: "primary",
    });
  }

  if (params.timingReportCardIds?.[0]) {
    overviewActions.push({
      label: "查看单股报告",
      href: `/timing/reports/${params.timingReportCardIds[0]}`,
    });
  }

  const notices: IndustryConclusionNotice[] = [];

  if (params.timingReportCardIds?.[0]) {
    notices.push({
      title: "择时报告入口",
      description:
        "若需要继续查看价格结构图、证据引擎和复盘时间线，可进入对应单股报告。",
      tone: "info",
      actions: [
        {
          label: "查看单股报告",
          href: `/timing/reports/${params.timingReportCardIds[0]}`,
        },
      ],
    });
  }

  return {
    query: params.query ?? "",
    generatedAtLabel: formatDate(result.generatedAt),
    headline: result.heatConclusion,
    summary: result.overview,
    verdictLabel: digest.verdictLabel,
    verdictTone: digest.verdictTone,
    activeSectionId: "overview",
    statusLabel: statusLabelMap[params.status ?? ""] ?? "可查看",
    modePills: getIndustryResearchModePills(result, params.input),
    metricStrip: [
      {
        label: "可信度",
        value:
          confidenceAnalysis?.finalScore === null ||
          confidenceAnalysis?.finalScore === undefined
            ? "未分析"
            : String(confidenceAnalysis.finalScore),
      },
      {
        label: "赛道热度",
        value: `${result.heatScore.toFixed(0)}%`,
      },
      {
        label: "候选标的",
        value: String(result.candidates.length),
      },
      {
        label: "重点标的",
        value: String(result.topPicks.length),
      },
      ...(typeof result.contractScore === "number"
        ? [
            {
              label: "合同得分",
              value: String(Math.round(result.contractScore)),
            },
          ]
        : []),
    ],
    overviewPoints:
      visibleOverviewPoints.length > 0
        ? visibleOverviewPoints
        : ["本轮行业结论已生成，可继续下钻。"],
    overviewActions,
    notices,
    sections,
    logic: {
      fullReportMarkdown:
        typeof result.fullReportMarkdown === "string" &&
        result.fullReportMarkdown.trim().length > 0
          ? result.fullReportMarkdown
          : undefined,
      industryDrivers: uniqueList(
        [
          ...result.credibility.flatMap((item) => item.highlights),
          ...result.candidates.map((item) => item.reason),
        ],
        6,
      ),
      competitionSummary:
        result.competitionSummary.trim() || "暂无结构化竞争格局总结。",
      topPicks,
    },
    evidence: {
      scoreLabel:
        confidenceAnalysis?.finalScore === null ||
        confidenceAnalysis?.finalScore === undefined
          ? "未分析"
          : String(confidenceAnalysis.finalScore),
      levelLabel: formatConfidenceLevel(confidenceAnalysis?.level),
      coverageLabel: confidenceAnalysis
        ? `${confidenceAnalysis.evidenceCoverageScore}%`
        : "未分析",
      tripletLabel: confidenceAnalysis
        ? `${confidenceAnalysis.supportedCount}/${confidenceAnalysis.insufficientCount}/${confidenceAnalysis.contradictedCount}`
        : "0/0/0",
      notes: cleanConclusionTextList(
        [...(confidenceAnalysis?.notes ?? []), result.reflection?.summary],
        5,
      ),
      qualityFlags: cleanConclusionTextList(
        [
          ...(result.qualityFlags ?? []),
          ...(result.reflection?.qualityFlags ?? []),
        ].filter((item) => item !== "open_questions_remaining"),
        6,
      ),
      missingRequirements: cleanConclusionTextList(
        [
          ...(result.missingRequirements ?? []),
          ...(result.reflection?.missingRequirements ?? []),
        ],
        6,
      ),
      claims: (confidenceAnalysis?.claims ?? []).map((item) => ({
        claimId: item.claimId,
        claimText: item.claimText,
        label: item.label,
        explanation: item.explanation,
      })),
    },
    risks: {
      summary: shouldHideIndustryConclusionText(result.gapAnalysis?.summary)
        ? digest.bearPoints.find(
            (item) => !shouldHideIndustryConclusionText(item),
          ) || "当前暂无结构化风险缺口。"
        : result.gapAnalysis?.summary ||
          digest.bearPoints[0] ||
          "当前暂无结构化风险缺口。",
      missingAreas: cleanConclusionTextList(
        result.gapAnalysis?.missingAreas ?? [],
        6,
      ),
      riskSignals: cleanConclusionTextList(
        [
          ...result.credibility.flatMap((item) => item.risks),
          ...digest.bearPoints,
        ],
        6,
      ),
      unansweredQuestions: uniqueList(
        [
          ...(result.reflection?.unansweredQuestions ?? []),
          ...(result.compressedFindings?.openQuestions ?? []),
        ],
        6,
      ),
      nextActions:
        cleanConclusionTextList(
          [...(result.reflection?.suggestedFixes ?? []), ...digest.nextActions],
          6,
        ).length > 0
          ? cleanConclusionTextList(
              [
                ...(result.reflection?.suggestedFixes ?? []),
                ...digest.nextActions,
              ],
              6,
            )
          : ["继续跟踪后续行业变化"],
    },
  };
}
