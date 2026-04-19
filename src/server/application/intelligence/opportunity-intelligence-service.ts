import type { PrismaClient } from "@prisma/client";
import type { MarketContextSnapshot } from "~/contracts/market-context";
import type {
  AvoidanceLead,
  OpportunityIntelligenceFeed,
  OpportunityIntelligenceSummary,
  OpportunityLead,
} from "~/contracts/opportunity-intelligence";
import type {
  CompanyEvidence,
  CompanyResearchPack,
} from "~/server/domain/intelligence/types";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";

type MarketContextClient = {
  getSnapshot(options?: {
    themeLimit?: number;
  }): Promise<MarketContextSnapshot>;
};

type IntelligenceClient = {
  getEvidence(stockCode: string, concept?: string): Promise<CompanyEvidence>;
  getCompanyResearchPack(params: {
    stockCode: string;
    concept?: string;
  }): Promise<CompanyResearchPack>;
};

type UserContextSignals = {
  recentResearchMatchCount: number;
  watchlistMatchCount: number;
  portfolioMatchCount: number;
};

type UserContext = UserContextSignals & {
  recentResearchCorpus: string;
  watchlistCodes: Set<string>;
  portfolioCodes: Set<string>;
};

type BaseLeadMetrics = {
  lead: OpportunityLead;
  realizationPriority: number;
  catalystPriority: number;
  expansionPriority: number;
  userAffinity: number;
  shouldAvoid: boolean;
  avoidanceReason?: string;
};

type EnrichedLead = {
  lead: OpportunityLead;
  evidence?: CompanyEvidence | null;
  researchPack?: CompanyResearchPack | null;
};

const THEME_LIMIT_SUMMARY = 6;
const THEME_LIMIT_FEED = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(normalizeText(needle)));
}

function shortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash).toString(36).slice(0, 8).padEnd(8, "0");
}

function slugifyLeadTitle(title: string) {
  const asciiTokens = title
    .replace(/AI/gi, "ai")
    .replace(/订单/g, " orders ")
    .replace(/兑现/g, " ")
    .replace(/靠近/g, " ")
    .replace(/[:：]/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 3);

  if (asciiTokens.length > 0) {
    return asciiTokens.join("-");
  }

  return `lead-${shortHash(title)}`;
}

function buildLeadTitle(theme: string, stage: OpportunityLead["stage"]) {
  switch (stage) {
    case "near_realization":
      return `${theme}: 订单兑现靠近`;
    case "expanding":
      return `${theme}: 产业链扩散`;
    case "catalyst":
      return `${theme}: 催化增强`;
    case "validating":
      return `${theme}: 兑现验证中`;
    case "cooling":
      return `${theme}: 高热先别追`;
    default:
      return `${theme}: 进入观察`;
  }
}

function buildPrioritySegments(
  theme: MarketContextSnapshot["hotThemes"][number],
) {
  const tokens = new Set<string>();

  for (const candidate of theme.candidateStocks) {
    if (candidate.reason.includes("服务器")) {
      tokens.add("服务器");
    }
    if (candidate.reason.includes("光模块")) {
      tokens.add("光模块");
    }
    if (candidate.reason.includes("订单")) {
      tokens.add("订单兑现");
    }
    if (candidate.reason.includes("执行器")) {
      tokens.add("执行器");
    }
    if (tokens.size >= 3) {
      break;
    }
  }

  if (tokens.size === 0) {
    for (const candidate of theme.candidateStocks.slice(0, 3)) {
      tokens.add(candidate.stockName);
    }
  }

  if (tokens.size === 0) {
    tokens.add(theme.theme);
  }

  return Array.from(tokens).slice(0, 3);
}

function buildRecommendedQuestion(
  theme: MarketContextSnapshot["hotThemes"][number],
) {
  return `围绕 ${theme.theme} 产业链，哪些环节最先兑现订单和收入？`;
}

function parseWatchlistStocks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      item &&
      typeof item === "object" &&
      "stockCode" in item &&
      typeof item.stockCode === "string"
        ? {
            stockCode: item.stockCode,
            stockName:
              "stockName" in item && typeof item.stockName === "string"
                ? item.stockName
                : item.stockCode,
          }
        : null,
    )
    .filter(Boolean) as Array<{ stockCode: string; stockName: string }>;
}

function parsePortfolioPositions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      item &&
      typeof item === "object" &&
      "stockCode" in item &&
      typeof item.stockCode === "string"
        ? {
            stockCode: item.stockCode,
            stockName:
              "stockName" in item && typeof item.stockName === "string"
                ? item.stockName
                : item.stockCode,
          }
        : null,
    )
    .filter(Boolean) as Array<{ stockCode: string; stockName: string }>;
}

function buildLeadHref(slug: string) {
  return `/opportunity-intelligence?lead=${encodeURIComponent(slug)}`;
}

export class OpportunityIntelligenceService {
  constructor(
    private readonly deps: {
      db: Pick<PrismaClient, "workflowRun" | "watchList" | "portfolioSnapshot">;
      marketContextClient: MarketContextClient;
      intelligenceClient: IntelligenceClient;
    },
  ) {}

  async getFeedForUser(userId: string): Promise<OpportunityIntelligenceFeed> {
    const snapshot = await this.deps.marketContextClient.getSnapshot({
      themeLimit: THEME_LIMIT_FEED,
    });
    const userContext = await this.loadUserContext(userId);
    const baseLeads = this.buildBaseLeads(snapshot, userContext);
    const prioritized = baseLeads
      .filter((item) => !item.shouldAvoid)
      .sort(compareLeadPriority);
    const enriched = await Promise.all(
      prioritized
        .slice(0, 6)
        .map((item) => this.enrichLead(item.lead))
        .concat(
          prioritized.slice(6).map(async (item) => ({
            lead: item.lead,
            evidence: null,
            researchPack: null,
          })),
        ),
    );
    const enrichedBySlug = new Map(
      enriched.map((item) => [item.lead.slug, item] as const),
    );
    const rebuilt = prioritized
      .map((item) => {
        const enrichedItem = enrichedBySlug.get(item.lead.slug);
        if (!enrichedItem) {
          return item;
        }

        return this.rebuildLeadWithEvidence(item, enrichedItem);
      })
      .sort(compareLeadPriority);
    const avoidanceItems = baseLeads
      .filter((item) => item.shouldAvoid)
      .sort((left, right) => right.lead.heatScore - left.lead.heatScore)
      .slice(0, 3)
      .map(
        (item): AvoidanceLead => ({
          slug: item.lead.slug,
          theme: item.lead.theme,
          title: buildLeadTitle(item.lead.theme, "cooling"),
          reason:
            item.avoidanceReason ??
            "热度过高但兑现路径偏弱，先不作为优先研究对象。",
          warningTone: "warning",
        }),
      );

    return {
      asOf: snapshot.asOf,
      status: snapshot.status,
      marketSummary: {
        todayConclusion: this.buildTodayConclusion(rebuilt, snapshot),
        regimeSummary: snapshot.regime.summary,
        flowSummary: snapshot.flow.summary,
      },
      personalization: {
        recentResearchMatchCount: userContext.recentResearchMatchCount,
        watchlistMatchCount: userContext.watchlistMatchCount,
        portfolioMatchCount: userContext.portfolioMatchCount,
      },
      todayTopLeads: rebuilt.slice(0, 4).map((item) => item.lead),
      trackingLeads: rebuilt.slice(4, 16).map((item) => item.lead),
      avoidanceItems,
    };
  }

  async getSummaryForUser(
    userId: string,
    limit = 3,
  ): Promise<OpportunityIntelligenceSummary> {
    const safeLimit = clamp(limit, 1, 3);
    const snapshot = await this.deps.marketContextClient.getSnapshot({
      themeLimit: THEME_LIMIT_SUMMARY,
    });
    const userContext = await this.loadUserContext(userId);
    const leads = this.buildBaseLeads(snapshot, userContext)
      .filter((item) => !item.shouldAvoid)
      .sort(compareLeadPriority)
      .slice(0, safeLimit)
      .map((item) => ({
        slug: item.lead.slug,
        title: item.lead.title,
        theme: item.lead.theme,
        stage: item.lead.stage,
        whyNow: item.lead.whyNow,
        whyRecommendedForYou: item.lead.whyRecommendedForYou ?? null,
        href: buildLeadHref(item.lead.slug),
      }));

    return {
      asOf: snapshot.asOf,
      status: snapshot.status,
      leads,
      personalizationHitCount:
        userContext.recentResearchMatchCount +
        userContext.watchlistMatchCount +
        userContext.portfolioMatchCount,
    };
  }

  private async loadUserContext(userId: string): Promise<UserContext> {
    const [workflowRuns, watchLists, portfolioSnapshot] = await Promise.all([
      this.deps.db.workflowRun.findMany({
        where: {
          userId,
          template: {
            code: {
              in: [
                QUICK_RESEARCH_TEMPLATE_CODE,
                COMPANY_RESEARCH_TEMPLATE_CODE,
              ],
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 15,
        select: {
          query: true,
          input: true,
        },
      }),
      this.deps.db.watchList.findMany({
        where: {
          userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 5,
        select: {
          stocks: true,
        },
      }),
      this.deps.db.portfolioSnapshot.findFirst({
        where: {
          userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          positions: true,
        },
      }),
    ]);

    const recentResearchCorpus = workflowRuns
      .map((run) => `${run.query} ${JSON.stringify(run.input ?? {})}`)
      .join(" ")
      .toLowerCase();
    const watchlistCodes = new Set<string>();
    const portfolioCodes = new Set<string>();

    for (const watchList of watchLists) {
      for (const stock of parseWatchlistStocks(watchList.stocks)) {
        watchlistCodes.add(stock.stockCode);
        watchlistCodes.add(stock.stockName);
      }
    }

    for (const position of parsePortfolioPositions(
      portfolioSnapshot?.positions,
    )) {
      portfolioCodes.add(position.stockCode);
      portfolioCodes.add(position.stockName);
    }

    return {
      recentResearchCorpus,
      watchlistCodes,
      portfolioCodes,
      recentResearchMatchCount: 0,
      watchlistMatchCount: 0,
      portfolioMatchCount: 0,
    };
  }

  private buildBaseLeads(
    snapshot: MarketContextSnapshot,
    rawUserContext: UserContext,
  ) {
    let recentResearchMatchCount = 0;
    let watchlistMatchCount = 0;
    let portfolioMatchCount = 0;

    const leads = snapshot.hotThemes.map((theme) => {
      const researchMatch = includesAny(rawUserContext.recentResearchCorpus, [
        theme.theme,
        ...theme.candidateStocks.map((item) => item.stockCode),
        ...theme.candidateStocks.map((item) => item.stockName),
      ]);
      const watchlistMatch = theme.candidateStocks.some(
        (item) =>
          rawUserContext.watchlistCodes.has(item.stockCode) ||
          rawUserContext.watchlistCodes.has(item.stockName),
      );
      const portfolioMatch = theme.candidateStocks.some(
        (item) =>
          rawUserContext.portfolioCodes.has(item.stockCode) ||
          rawUserContext.portfolioCodes.has(item.stockName),
      );

      recentResearchMatchCount += researchMatch ? 1 : 0;
      watchlistMatchCount += watchlistMatch ? 1 : 0;
      portfolioMatchCount += portfolioMatch ? 1 : 0;

      const positiveNewsCount = theme.topNews.filter(
        (item) => item.sentiment === "positive",
      ).length;
      const negativeNewsCount = theme.topNews.filter(
        (item) => item.sentiment === "negative",
      ).length;
      const candidateHeat = average(
        theme.candidateStocks.map((item) => item.heat),
      );
      const catalystPriority = Math.round(
        average(
          theme.topNews.map(
            (item) =>
              item.relevanceScore * 100 +
              (item.sentiment === "positive"
                ? 8
                : item.sentiment === "negative"
                  ? -8
                  : 0),
          ),
        ),
      );
      const expansionPriority =
        theme.candidateStocks.length * 12 +
        theme.conceptMatches.length * 10 +
        Math.round(candidateHeat * 0.35);
      const userAffinity =
        (researchMatch ? 3 : 0) +
        (watchlistMatch ? 2 : 0) +
        (portfolioMatch ? 1 : 0);
      const shouldAvoid =
        theme.candidateStocks.length === 0 ||
        negativeNewsCount > positiveNewsCount ||
        (theme.heatScore >= 88 &&
          candidateHeat < 70 &&
          positiveNewsCount === 0);
      const stage: OpportunityLead["stage"] = shouldAvoid
        ? "cooling"
        : theme.candidateStocks.length >= 2 && positiveNewsCount > 0
          ? "expanding"
          : positiveNewsCount > 0
            ? "catalyst"
            : "warming";

      const title = buildLeadTitle(theme.theme, stage);
      const slug = slugifyLeadTitle(title);
      const lead: OpportunityLead = {
        slug,
        theme: theme.theme,
        title,
        stage,
        heatScore: theme.heatScore,
        whyNow: theme.whyHot,
        catalystSummary:
          theme.topNews[0]?.title ?? `${theme.theme} 的催化仍在继续发酵。`,
        realizationPath:
          theme.candidateStocks[0]?.reason ??
          `${theme.theme} 仍缺少清晰兑现路径，需要先验证。`,
        prioritySegments: buildPrioritySegments(theme),
        candidateStocks: theme.candidateStocks,
        topNews: theme.topNews,
        whyRanked: this.buildRankingReason({
          stage,
          userAffinity,
          positiveNewsCount,
        }),
        whyRecommendedForYou: this.buildPersonalizedReason({
          researchMatch,
          watchlistMatch,
          portfolioMatch,
        }),
        recommendedQuestion:
          snapshot.downstreamHints.workflows.suggestedQuestion ??
          buildRecommendedQuestion(theme),
      };

      return {
        lead,
        realizationPriority:
          stage === "expanding" ? 3 : stage === "catalyst" ? 2 : 1,
        catalystPriority,
        expansionPriority,
        userAffinity,
        shouldAvoid,
        avoidanceReason:
          shouldAvoid && theme.candidateStocks.length === 0
            ? "热度高但缺少可承接的受益环节和候选股，先不追。"
            : shouldAvoid
              ? "情绪热度偏高，但催化和兑现链条还不够扎实。"
              : undefined,
      } satisfies BaseLeadMetrics;
    });

    rawUserContext.recentResearchMatchCount = recentResearchMatchCount;
    rawUserContext.watchlistMatchCount = watchlistMatchCount;
    rawUserContext.portfolioMatchCount = portfolioMatchCount;

    return leads;
  }

  private async enrichLead(lead: OpportunityLead): Promise<EnrichedLead> {
    const [firstCandidate] = lead.candidateStocks;
    if (!firstCandidate) {
      return { lead, evidence: null, researchPack: null };
    }

    const [evidence, researchPack] = await Promise.all([
      this.deps.intelligenceClient
        .getEvidence(firstCandidate.stockCode, firstCandidate.concept)
        .catch(() => null),
      this.deps.intelligenceClient
        .getCompanyResearchPack({
          stockCode: firstCandidate.stockCode,
          concept: firstCandidate.concept,
        })
        .catch(() => null),
    ]);

    return { lead, evidence, researchPack };
  }

  private rebuildLeadWithEvidence(
    original: BaseLeadMetrics,
    enriched: EnrichedLead,
  ): BaseLeadMetrics {
    const credibility = enriched.evidence?.credibilityScore ?? 0;
    const stage: OpportunityLead["stage"] =
      credibility >= 80
        ? "near_realization"
        : credibility >= 65
          ? "validating"
          : original.lead.stage;
    const title = buildLeadTitle(original.lead.theme, stage);
    const nextLead: OpportunityLead = {
      ...original.lead,
      title,
      stage,
      whyNow:
        enriched.evidence?.evidenceSummary ??
        enriched.researchPack?.summaryNotes[0] ??
        original.lead.whyNow,
      realizationPath:
        enriched.researchPack?.summaryNotes[0] ??
        enriched.evidence?.evidenceSummary ??
        original.lead.realizationPath,
      whyRanked: this.buildRankingReason({
        stage,
        userAffinity: original.userAffinity,
        positiveNewsCount: original.lead.topNews.filter(
          (item) => item.sentiment === "positive",
        ).length,
      }),
    };

    return {
      ...original,
      lead: nextLead,
      realizationPriority:
        stage === "near_realization"
          ? 5
          : stage === "validating"
            ? 4
            : original.realizationPriority,
    };
  }

  private buildPersonalizedReason(params: {
    researchMatch: boolean;
    watchlistMatch: boolean;
    portfolioMatch: boolean;
  }) {
    const reasons: string[] = [];

    if (params.researchMatch) {
      reasons.push("最近研究");
    }
    if (params.watchlistMatch) {
      reasons.push("自选");
    }
    if (params.portfolioMatch) {
      reasons.push("持仓");
    }

    if (reasons.length === 0) {
      return null;
    }

    return `因为它和你的${reasons.join(" / ")}链路直接相关。`;
  }

  private buildRankingReason(params: {
    stage: OpportunityLead["stage"];
    userAffinity: number;
    positiveNewsCount: number;
  }) {
    const stageText =
      params.stage === "near_realization"
        ? "更接近兑现"
        : params.stage === "validating"
          ? "正处于兑现验证期"
          : params.stage === "expanding"
            ? "扩散范围更广"
            : "催化仍在增强";
    const personalText =
      params.userAffinity > 0 ? "，且与你已有研究链路相关" : "";
    const newsText = params.positiveNewsCount > 0 ? "，近期催化保持活跃" : "";

    return `${stageText}${newsText}${personalText}。`;
  }

  private buildTodayConclusion(
    leads: BaseLeadMetrics[],
    snapshot: MarketContextSnapshot,
  ) {
    const [firstLead] = leads;
    if (!firstLead) {
      return "当前可用线索有限，先保守观察。";
    }

    return `优先研究 ${firstLead.lead.theme} 等更接近兑现的主线，${snapshot.flow.summary}`;
  }
}

function compareLeadPriority(left: BaseLeadMetrics, right: BaseLeadMetrics) {
  return (
    right.realizationPriority - left.realizationPriority ||
    right.catalystPriority - left.catalystPriority ||
    right.expansionPriority - left.expansionPriority ||
    right.userAffinity - left.userAffinity ||
    right.lead.heatScore - left.lead.heatScore
  );
}
