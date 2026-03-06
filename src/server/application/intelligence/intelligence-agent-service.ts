import type {
  CompanyEvidence,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
import type {
  QuickResearchCandidate,
  QuickResearchCredibility,
  QuickResearchResultDto,
} from "~/server/domain/workflow/types";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { ScreeningFacade } from "~/server/application/screening/screening-facade";

export type MarketHeatAnalysis = {
  heatScore: number;
  heatConclusion: string;
  news: ThemeNewsItem[];
};

export type IntelligenceAgentServiceDependencies = {
  deepSeekClient: DeepSeekClient;
  dataClient: PythonIntelligenceDataClient;
  screeningFacade: ScreeningFacade;
};

function buildHeatScore(news: ThemeNewsItem[]) {
  if (news.length === 0) {
    return 50;
  }

  const sentimentWeight = {
    positive: 8,
    neutral: 0,
    negative: -8,
  } as const;

  const total = news.reduce((acc, item) => {
    return acc + item.relevanceScore * 100 + sentimentWeight[item.sentiment];
  }, 0);

  return Math.max(0, Math.min(100, Math.round(total / news.length)));
}

function formatHeatConclusion(score: number): string {
  if (score >= 75) {
    return "行业热度高，资金关注度与催化事件均较强。";
  }

  if (score >= 55) {
    return "行业热度中性偏强，建议结合估值与事件窗口择时。";
  }

  return "行业热度偏弱，建议控制仓位并优先防守型标的。";
}

function mapEvidenceToCredibility(
  evidence: CompanyEvidence,
  fallbackScore: number,
): QuickResearchCredibility {
  return {
    stockCode: evidence.stockCode,
    credibilityScore: evidence.credibilityScore || fallbackScore,
    highlights: evidence.catalysts,
    risks: evidence.risks,
  };
}

export class IntelligenceAgentService {
  private readonly deepSeekClient: DeepSeekClient;
  private readonly dataClient: PythonIntelligenceDataClient;
  private readonly screeningFacade: ScreeningFacade;

  constructor(dependencies: IntelligenceAgentServiceDependencies) {
    this.deepSeekClient = dependencies.deepSeekClient;
    this.dataClient = dependencies.dataClient;
    this.screeningFacade = dependencies.screeningFacade;
  }

  async generateIndustryOverview(query: string): Promise<{ overview: string; news: ThemeNewsItem[] }> {
    const news = await this.dataClient.getThemeNews({
      theme: query,
      days: 7,
      limit: 20,
    });

    const fallbackOverview =
      news.length === 0
        ? `围绕“${query}”，近期公开资讯较少，建议补充产业链上下游访谈和财报佐证。`
        : `围绕“${query}”的近期资讯显示，主要催化集中在政策、订单与资本开支。`;

    const overview = await this.deepSeekClient
      .complete(
        [
          {
            role: "system",
            content:
              "你是股票投研助手，请输出一段不超过120字的行业概览，避免空话，强调驱动因素。",
          },
          {
            role: "user",
            content: `赛道: ${query}\n资讯样本: ${news
              .slice(0, 5)
              .map((item) => `- ${item.title}`)
              .join("\n")}`,
          },
        ],
        fallbackOverview,
      )
      .catch(() => fallbackOverview);

    return {
      overview,
      news,
    };
  }

  async analyzeMarketHeat(query: string, newsFromOverview?: ThemeNewsItem[]): Promise<MarketHeatAnalysis> {
    const news =
      newsFromOverview ??
      (await this.dataClient.getThemeNews({
        theme: query,
        days: 7,
        limit: 20,
      }));

    const heatScore = buildHeatScore(news);
    const fallbackConclusion = formatHeatConclusion(heatScore);

    const heatConclusion = await this.deepSeekClient
      .complete(
        [
          {
            role: "system",
            content:
              "你是量化投研助理，请基于热度分数输出一句结论，控制在60字以内。",
          },
          {
            role: "user",
            content: `赛道: ${query}\n热度分数: ${heatScore}\n最近资讯数: ${news.length}`,
          },
        ],
        fallbackConclusion,
      )
      .catch(() => fallbackConclusion);

    return {
      heatScore,
      heatConclusion,
      news,
    };
  }

  async screenCandidates(query: string, heatScore: number): Promise<QuickResearchCandidate[]> {
    return this.screeningFacade.screenCandidates(query, heatScore);
  }

  async evaluateCredibility(
    concept: string,
    candidates: QuickResearchCandidate[],
  ): Promise<QuickResearchCredibility[]> {
    const evidenceList = await this.dataClient.getEvidenceBatch({
      concept,
      stockCodes: candidates.map((candidate) => candidate.stockCode),
    });

    const mapped = new Map(
      evidenceList.map((evidence) => [
        evidence.stockCode,
        mapEvidenceToCredibility(evidence, 70),
      ]),
    );

    return candidates.map((candidate, index) => {
      return (
        mapped.get(candidate.stockCode) ?? {
          stockCode: candidate.stockCode,
          credibilityScore: Math.max(55, candidate.score - index * 4),
          highlights: [candidate.reason],
          risks: ["缺少近期公告佐证，需要补充核验"],
        }
      );
    });
  }

  async summarizeCompetition(params: {
    query: string;
    candidates: QuickResearchCandidate[];
    credibility: QuickResearchCredibility[];
  }): Promise<string> {
    const fallback = `${params.query}赛道竞争呈现头部集中趋势，建议优先关注盈利质量和订单可持续性。`;

    return this.deepSeekClient
      .complete(
        [
          {
            role: "system",
            content:
              "你是产业研究员，请输出一句竞争格局总结（80字以内），突出龙头优势与边际风险。",
          },
          {
            role: "user",
            content: `赛道: ${params.query}\n候选标的: ${params.candidates
              .map((item) => `${item.stockName}(${item.stockCode})`) 
              .join("、")}\n可信度: ${params.credibility
              .map((item) => `${item.stockCode}:${item.credibilityScore}`)
              .join(",")}`,
          },
        ],
        fallback,
      )
      .catch(() => fallback);
  }

  buildFinalReport(params: {
    overview: string;
    heatScore: number;
    heatConclusion: string;
    candidates: QuickResearchCandidate[];
    credibility: QuickResearchCredibility[];
    competitionSummary: string;
  }): QuickResearchResultDto {
    const topCredibility = [...params.credibility].sort(
      (left, right) => right.credibilityScore - left.credibilityScore,
    );

    const topPicks = topCredibility.slice(0, 3).map((item) => {
      const candidate = params.candidates.find(
        (candidateItem) => candidateItem.stockCode === item.stockCode,
      );

      return {
        stockCode: item.stockCode,
        stockName: candidate?.stockName ?? item.stockCode,
        reason: item.highlights[0] ?? "具备相对优势",
      };
    });

    return {
      overview: params.overview,
      heatScore: params.heatScore,
      heatConclusion: params.heatConclusion,
      candidates: params.candidates,
      credibility: params.credibility,
      topPicks,
      competitionSummary: params.competitionSummary,
      generatedAt: new Date().toISOString(),
    };
  }
}
