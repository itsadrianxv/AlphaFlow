import { z } from "zod";
import type { ConfidenceAnalysis } from "~/modules/research/server/domain/intelligence/confidence";
import type { EvidenceReference } from "~/modules/research/server/domain/intelligence/entities/evidence-reference";
import type { InsightQualityService } from "~/modules/research/server/domain/intelligence/services/insight-quality-service";
import type { ReviewPlanPolicy } from "~/modules/research/server/domain/intelligence/services/review-plan-policy";
import type {
  ScreeningFactsBundle,
  ScreeningInsightStatus,
} from "~/modules/research/server/domain/intelligence/types";
import { Catalyst } from "~/modules/research/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/modules/research/server/domain/intelligence/value-objects/investment-thesis";
import type { ReviewPlan } from "~/modules/research/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/modules/research/server/domain/intelligence/value-objects/risk-point";

const thesisSchema = z.object({
  summary: z.string().min(1),
  whyNow: z.string().min(1),
  drivers: z.array(z.string().min(1)).min(1),
  monetizationPath: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

const riskSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  description: z.string().min(1),
  monitorMetric: z.string().min(1),
  invalidatesThesisWhen: z.string().min(1),
});

const catalystSchema = z.object({
  title: z.string().min(1),
  windowType: z.enum(["event", "earnings", "policy", "product", "order"]),
  importance: z.number().int().min(1).max(5),
  description: z.string().min(1),
  expectedDate: z.string().optional(),
  sourceRefId: z.string().optional(),
});

const llmOutputSchema = z.object({
  thesis: thesisSchema,
  risks: z.array(riskSchema),
  catalysts: z.array(catalystSchema),
  extraChecks: z.array(z.string()),
});

export type InsightCompletionMessage = {
  role: "system" | "user";
  content: string;
};

export interface InsightCompletionClient {
  completeJson<T>(
    messages: InsightCompletionMessage[],
    fallbackValue: T,
  ): Promise<T>;
}

export type SynthesizedInsightDraft = {
  thesis: InvestmentThesis;
  risks: RiskPoint[];
  catalysts: Catalyst[];
  reviewPlan: ReviewPlan;
  evidenceRefs: EvidenceReference[];
  qualityFlags: ReturnType<InsightQualityService["evaluate"]>;
  confidenceAnalysis?: ConfidenceAnalysis;
  status: ScreeningInsightStatus;
};

export type InsightSynthesisServiceDependencies = {
  completionClient: InsightCompletionClient;
  reviewPlanPolicy: ReviewPlanPolicy;
  qualityService: InsightQualityService;
};

function getAverageEvidenceCredibility(bundle: ScreeningFactsBundle) {
  const validScores = bundle.companyEvidence
    .map((item) => item.credibilityScore)
    .filter((item): item is number => typeof item === "number");

  if (validScores.length === 0) {
    return null;
  }

  return (
    validScores.reduce((sum, value) => sum + value, 0) / validScores.length
  );
}

function getFallbackConfidence(bundle: ScreeningFactsBundle) {
  const evidenceCredibility = getAverageEvidenceCredibility(bundle);

  if (bundle.screening.score >= 0.85 && (evidenceCredibility ?? 0.6) >= 0.7) {
    return "high" as const;
  }

  if (bundle.screening.score >= 0.7 && (evidenceCredibility ?? 0.5) >= 0.45) {
    return "medium" as const;
  }

  return "low" as const;
}

function inferCatalystWindowType(text: string) {
  if (text.includes("财报") || text.includes("业绩")) {
    return "earnings" as const;
  }

  if (text.includes("政策") || text.includes("监管")) {
    return "policy" as const;
  }

  if (text.includes("订单") || text.includes("中标")) {
    return "order" as const;
  }

  if (text.includes("产品") || text.includes("发布")) {
    return "product" as const;
  }

  return "event" as const;
}

function buildFallbackOutput(bundle: ScreeningFactsBundle) {
  const confidence = getFallbackConfidence(bundle);
  const topEvidence = bundle.companyEvidence[0];
  const concept = bundle.conceptMatches[0]?.concept;
  const scorePercent = Math.round(bundle.screening.scorePercent);
  const drivers = [
    ...bundle.screening.scoreExplanations,
    ...bundle.companyEvidence.map((item) => item.extractedFact),
  ]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);

  const risks = bundle.companyEvidence.flatMap((item) =>
    item.snippet ? [] : [],
  );
  void risks;

  return {
    thesis: {
      summary:
        topEvidence?.extractedFact ??
        `${bundle.stock.stockName} 在本次筛选中进入前列，值得继续跟踪。`,
      whyNow:
        topEvidence?.snippet ??
        `当前评分达到 ${scorePercent} 分位，且命中了多个关键筛选条件。`,
      drivers:
        drivers.length > 0
          ? drivers
          : ["筛选评分靠前", "命中关键条件", "具备后续跟踪价值"],
      monetizationPath: concept
        ? `围绕 ${concept} 相关业务扩张与订单兑现形成业绩释放。`
        : "通过主营业务兑现、订单扩张或盈利改善驱动估值修复。",
      confidence,
    },
    risks: bundle.companyEvidence
      .flatMap((item) => (item.snippet ? [] : []))
      .slice(0, 0),
    catalysts: bundle.companyEvidence
      .map((item) => item.extractedFact)
      .filter((item) => item.length > 0)
      .slice(0, 2)
      .map((item, index) => ({
        title: `催化线索 ${index + 1}`,
        windowType: inferCatalystWindowType(item),
        importance: confidence === "high" ? 4 : 3,
        description: item,
      })),
    extraChecks: [
      "核验下一次财报或经营公告窗口",
      "跟踪主要业务订单与盈利兑现情况",
    ],
  };
}

function buildFallbackRiskPoints(bundle: ScreeningFactsBundle) {
  const companyEvidence = bundle.companyEvidence;
  const riskTexts = companyEvidence
    .flatMap((item) => item.snippet.split(/[；。]/))
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 2);

  if (riskTexts.length === 0) {
    return [
      {
        title: "证据覆盖不足",
        severity: "medium" as const,
        description: "当前结构化证据较少，结论仍需补充财报与公告核验。",
        monitorMetric: "新增公告、财报披露、订单进展",
        invalidatesThesisWhen: "后续无法补充关键证据或业务验证失败时",
      },
    ];
  }

  return riskTexts.map((item, index) => ({
    title: `风险点 ${index + 1}`,
    severity: "medium" as const,
    description: item,
    monitorMetric: "公告与经营数据",
    invalidatesThesisWhen: "对应风险持续恶化且缺少对冲因素时",
  }));
}

export class InsightSynthesisService {
  private readonly completionClient: InsightCompletionClient;
  private readonly reviewPlanPolicy: ReviewPlanPolicy;
  private readonly qualityService: InsightQualityService;

  constructor(dependencies: InsightSynthesisServiceDependencies) {
    this.completionClient = dependencies.completionClient;
    this.reviewPlanPolicy = dependencies.reviewPlanPolicy;
    this.qualityService = dependencies.qualityService;
  }

  async synthesize(params: {
    factsBundle: ScreeningFactsBundle;
    evidenceRefs: EvidenceReference[];
  }): Promise<SynthesizedInsightDraft> {
    const fallback = buildFallbackOutput(params.factsBundle);
    const rawOutput = await this.completionClient.completeJson(
      [
        {
          role: "system",
          content:
            "你是结构化投研分析师。请仅基于事实包输出 JSON，字段必须包含 thesis、risks、catalysts、extraChecks。不要编造未提供的事实。",
        },
        {
          role: "user",
          content: JSON.stringify(params.factsBundle, null, 2),
        },
      ],
      fallback,
    );

    const parsed = llmOutputSchema.safeParse(rawOutput);
    const normalized = parsed.success
      ? parsed.data
      : {
          ...fallback,
          risks: buildFallbackRiskPoints(params.factsBundle),
        };

    const thesis = InvestmentThesis.create(normalized.thesis);
    const risks = (
      normalized.risks.length > 0
        ? normalized.risks
        : buildFallbackRiskPoints(params.factsBundle)
    ).map((item) => RiskPoint.create(item));
    const catalysts = normalized.catalysts.map((item) => Catalyst.create(item));

    const qualityFlags = this.qualityService.evaluate({
      factsBundle: params.factsBundle,
      evidenceRefs: params.evidenceRefs,
      thesis,
      risks,
      conceptMatches: params.factsBundle.conceptMatches,
    });

    const reviewPlan = this.reviewPlanPolicy.build({
      asOf: new Date(params.factsBundle.asOf),
      confidence: thesis.confidence,
      qualityFlags,
      risks,
      catalysts,
      extraChecks: normalized.extraChecks,
    });

    return {
      thesis,
      risks,
      catalysts,
      reviewPlan,
      evidenceRefs: params.evidenceRefs,
      qualityFlags,
      status: this.qualityService.requiresManualReview(qualityFlags)
        ? "NEEDS_REVIEW"
        : "ACTIVE",
    };
  }
}
