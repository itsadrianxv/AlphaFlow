import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { EvidenceAwareLlmClient } from "~/server/application/evidence-context/evidence-aware-llm-client";
import type { SharedNewsLibraryService } from "~/server/application/intelligence/shared-news-library-service";
import type { EvidenceCitation } from "~/server/domain/evidence-context/types";
import {
  type ImpactContext,
  type ImpactEdge,
  type ImpactMappingInput,
  type ImpactMappingResult,
  type ImpactRadarEvent,
  type ImpactScenario,
  type ImpactTimelineItem,
  impactEdgeSchema,
  impactScenarioSchema,
} from "~/server/domain/intelligence/impact-mapping";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";
import type { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import type { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";
import type { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import type { PythonMarketContextClient } from "~/server/infrastructure/intelligence/python-market-context-client";

const NEWS_DEADLINE_MS = 600_000;
const TRACE_WINDOW_DAYS = 30;
const MAX_HISTORICAL_NEWS = 5;

type WebEvidence = {
  id: string;
  title: string;
  url: string;
  description: string;
};

export type ImpactCollectedEvidence = {
  news: ThemeNewsItem[];
  timelineNews?: ThemeNewsItem[];
  timelineNewsByEvent?: Record<string, ThemeNewsItem[]>;
  featuredEventIds?: string[];
  selectedEvent?: ThemeNewsItem;
  web: WebEvidence[];
  warnings: string[];
  tracedDays: number;
};

export type PersistedImpactEvidence = {
  contextId: string;
  itemIdBySourceId: Record<string, string>;
  evidenceItemIds: string[];
};

const impactOutputSchema = z.object({
  impactEdges: z.array(impactEdgeSchema).max(40),
  warnings: z.array(z.string()).default([]),
});

const scenarioOutputSchema = z.object({
  scenarios: z.array(impactScenarioSchema).min(2).max(5),
  warnings: z.array(z.string()).default([]),
});

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`${label}_timeout_${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function traceAnchor(event: ThemeNewsItem) {
  return {
    title: event.title,
    summary: event.summary,
    eventType: event.eventType,
    relatedStocks: event.relatedStocks,
    scopeTags: event.scopeTags,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseWatchListStocks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asObject(item))
    .map((item) => ({
      stockCode: asString(item.stockCode || item.code),
      stockName: asString(item.stockName || item.name),
    }))
    .filter((item) => /^\d{6}$/.test(item.stockCode));
}

function parsePositions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asObject(item))
    .map((item) => ({
      stockCode: asString(item.stockCode),
      stockName: asString(item.stockName),
      currentWeightPct: asNumber(item.weightPct),
    }))
    .filter((item) => /^\d{6}$/.test(item.stockCode));
}

function fallbackScenarios(
  event: ThemeNewsItem,
  evidenceItemIds: string[],
): ImpactScenario[] {
  return [
    {
      id: randomUUID(),
      name: "影响延续",
      horizon: "未来 30 至 90 天",
      triggers: ["事件相关政策、订单或价格信号继续得到确认"],
      confirmationSignals: ["后续公开信息与当前事件方向一致"],
      invalidationConditions: ["关键事实被修正或执行力度明显低于预期"],
      affectedTargets:
        event.relatedStocks.length > 0 ? event.relatedStocks : ["相关行业"],
      rationale: "基于当前事件方向的延续性推演。",
      evidenceItemIds,
      basis: "assumption",
    },
    {
      id: randomUUID(),
      name: "影响反转",
      horizon: "未来 30 至 90 天",
      triggers: ["出现相反政策、供需或竞争信号"],
      confirmationSignals: ["价格、订单或资本开支数据转弱"],
      invalidationConditions: ["当前趋势获得新的高可信证据支持"],
      affectedTargets:
        event.relatedStocks.length > 0 ? event.relatedStocks : ["相关行业"],
      rationale: "用于检查当前叙事可能失效的路径。",
      evidenceItemIds,
      basis: "assumption",
    },
  ];
}

export class ImpactMappingService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      dataClient: PythonIntelligenceDataClient;
      sharedNewsLibraryService?: Pick<SharedNewsLibraryService, "collectRadar">;
      capabilityClient: PythonCapabilityGatewayClient;
      marketContextClient?: Pick<PythonMarketContextClient, "getSnapshot">;
      evidenceRepository: PrismaEvidenceContextRepository;
      evidenceAwareLlmClient: EvidenceAwareLlmClient;
    },
  ) {}

  private async collectNewsRadar(
    request: {
      days: number;
      limit: number;
      endAt?: string;
      companies: ImpactContext["companies"];
      industries: ImpactContext["industries"];
      includeMacro?: boolean;
      traceAnchor?: ReturnType<typeof traceAnchor>;
    },
    label: string,
  ): Promise<{ news: ThemeNewsItem[]; warnings: string[] }> {
    if (this.deps.sharedNewsLibraryService) {
      return withDeadline(
        this.deps.sharedNewsLibraryService.collectRadar(request),
        NEWS_DEADLINE_MS,
        label,
      );
    }

    return {
      news: await withDeadline(
        this.deps.dataClient.getNewsRadar(request),
        NEWS_DEADLINE_MS,
        label,
      ),
      warnings: [],
    };
  }

  async loadContext(
    userId: string,
    input: ImpactMappingInput,
  ): Promise<ImpactContext> {
    const [portfolio, watchLists, savedCompanies, savedIndustries] =
      await Promise.all([
        input.portfolioCompositionId
          ? this.deps.prisma.portfolioComposition?.findFirst({
              where: { id: input.portfolioCompositionId, userId },
            })
          : this.deps.prisma.portfolioComposition?.findFirst({
              where: { userId },
              orderBy: { updatedAt: "desc" },
            }),
        this.deps.prisma.watchList.findMany({
          where: {
            userId,
            ...(input.watchListIds.length > 0
              ? { id: { in: input.watchListIds } }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: input.watchListIds.length > 0 ? input.watchListIds.length : 1,
        }),
        this.deps.prisma.savedCompany.findMany({
          where: { userId, archivedAt: null },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        this.deps.prisma.savedIndustry.findMany({
          where: { userId, archivedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);

    let positions = parsePositions(portfolio?.positions);
    let effectivePortfolio: ImpactContext["portfolio"] = portfolio
      ? { id: portfolio.id, name: portfolio.name, positions }
      : undefined;
    if (!portfolio && this.deps.marketContextClient) {
      try {
        const marketContext = await this.deps.marketContextClient.getSnapshot();
        const candidates = [
          ...new Map(
            marketContext.hotThemes
              .flatMap((theme) => theme.candidateStocks)
              .map((stock) => [stock.stockCode, stock] as const),
          ).values(),
        ];
        const weight = candidates.length > 0 ? 100 / candidates.length : 0;
        positions = candidates.map((stock) => ({
          ...stock,
          currentWeightPct: weight,
        }));
        if (positions.length > 0) {
          effectivePortfolio = {
            id: "market-context-candidates",
            name: "宏观分析候选股",
            positions,
          };
        }
      } catch {
        // 宏观分析暂不可用时保留原有空组合降级行为。
      }
    }
    const normalizedWatchLists = watchLists.map((watchList) => ({
      id: watchList.id,
      name: watchList.name,
      stocks: parseWatchListStocks(watchList.stocks),
    }));
    const companyMap = new Map<
      string,
      {
        id?: string;
        stockCode: string;
        companyName: string;
        aliases: string[];
        priority?: number;
      }
    >();
    const prioritizedTargets = [
      ...normalizedWatchLists.flatMap((watchList) =>
        watchList.stocks.map((stock, index) => ({
          kind: "company" as const,
          createdAt: watchLists[0]?.updatedAt ?? new Date(0),
          index,
          stock,
        })),
      ),
      ...savedCompanies.map((company, index) => ({
        kind: "savedCompany" as const,
        createdAt: company.createdAt,
        index,
        company,
      })),
      ...savedIndustries.map((industry, index) => ({
        kind: "industry" as const,
        createdAt: industry.createdAt,
        index,
        industry,
      })),
    ].sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.index - right.index,
    );
    const targetPriority = new Map<string, number>();
    prioritizedTargets.forEach((target, index) => {
      const key =
        target.kind === "industry"
          ? `industry:${target.industry.name}`
          : target.kind === "savedCompany"
            ? `company:${target.company.stockCode}`
            : `company:${target.stock.stockCode}`;
      if (!targetPriority.has(key)) {
        targetPriority.set(key, prioritizedTargets.length - index);
      }
    });
    for (const company of savedCompanies) {
      companyMap.set(company.stockCode, {
        id: company.id,
        stockCode: company.stockCode,
        companyName: company.companyName,
        aliases: unique([company.companyName, ...company.tags]),
        priority: targetPriority.get(`company:${company.stockCode}`),
      });
    }
    for (const stock of [
      ...positions,
      ...normalizedWatchLists.flatMap((item) => item.stocks),
    ]) {
      const current = companyMap.get(stock.stockCode);
      companyMap.set(stock.stockCode, {
        ...current,
        stockCode: stock.stockCode,
        companyName: current?.companyName || stock.stockName || stock.stockCode,
        aliases: unique(
          [...(current?.aliases ?? []), stock.stockName].filter(Boolean),
        ),
        priority:
          targetPriority.get(`company:${stock.stockCode}`) ?? current?.priority,
      });
    }

    const targetIds = unique([
      ...savedCompanies.map((item) => item.id),
      ...savedIndustries.map((item) => item.id),
      ...normalizedWatchLists.map((item) => item.id),
    ]);
    const hypotheses = targetIds.length
      ? await this.deps.prisma.researchNote.findMany({
          where: { userId, kind: "hypothesis", targetId: { in: targetIds } },
          orderBy: { updatedAt: "desc" },
          take: 50,
        })
      : [];

    return {
      portfolio: effectivePortfolio
        ? {
            id: effectivePortfolio.id,
            name: effectivePortfolio.name,
            positions,
          }
        : undefined,
      watchLists: normalizedWatchLists,
      companies: [...companyMap.values()],
      industries: savedIndustries.map((industry) => ({
        id: industry.id,
        name: industry.name,
        aliases: unique([industry.name, ...industry.tags]),
        priority: targetPriority.get(`industry:${industry.name}`),
      })),
      hypotheses: hypotheses.map((note) => ({
        id: note.id,
        targetType: note.targetType,
        targetId: note.targetId,
        title: note.title ?? undefined,
        content: note.contentMarkdown,
      })),
    };
  }

  async collectEvidence(params: {
    userId: string;
    input: ImpactMappingInput;
    context: ImpactContext;
  }): Promise<ImpactCollectedEvidence> {
    const { input, context } = params;
    if (input.mode === "radar" || input.mode === "overview") {
      const request = {
        days: input.days,
        limit: 50,
        companies: context.companies.filter(
          (company) => company.priority !== undefined,
        ),
        industries: context.industries.filter(
          (industry) => industry.priority !== undefined,
        ),
      };
      let collected: { news: ThemeNewsItem[]; warnings: string[] };
      try {
        collected = await this.collectNewsRadar(request, "radar_collect");
      } catch (error) {
        collected = {
          news: [],
          warnings: [
            `radar_collect_failed:${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
      const result = {
        news: collected.news,
        web: [],
        warnings: [
          ...collected.warnings,
          ...collected.news.flatMap((item) => item.warnings ?? []),
        ],
        tracedDays: input.days,
      } satisfies ImpactCollectedEvidence;
      if (
        input.mode === "overview" &&
        result.news.length === 0 &&
        result.warnings.some((warning) =>
          warning.startsWith("radar_collect_failed:"),
        )
      ) {
        throw new Error(result.warnings.join(";"));
      }
      if (input.mode !== "overview") return result;

      const featured = [...collected.news]
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, 3);
      const warnings = [...result.warnings];
      const timelineNewsByEvent: Record<string, ThemeNewsItem[]> = {};
      for (const event of featured) {
        const eventTime = new Date(event.publishedAt).getTime();
        const batches = await Promise.all(
          Array.from({ length: 12 }, async (_, index) => {
            const endAt = new Date(
              eventTime - index * TRACE_WINDOW_DAYS * 86_400_000,
            );
            try {
              const traced = await this.collectNewsRadar(
                {
                  days: TRACE_WINDOW_DAYS,
                  limit: 30,
                  endAt: endAt.toISOString(),
                  companies: context.companies,
                  industries: context.industries,
                  includeMacro: false,
                  traceAnchor: traceAnchor(event),
                },
                "overview_trace_window",
              );
              warnings.push(...traced.warnings);
              return traced.news;
            } catch (error) {
              warnings.push(
                `overview_trace_window_failed:${error instanceof Error ? error.message : String(error)}`,
              );
              return [];
            }
          }),
        );
        const historical = [
          ...new Map(
            batches
              .flat()
              .filter(
                (item) =>
                  item.id !== event.id &&
                  new Date(item.publishedAt).getTime() < eventTime,
              )
              .map((item) => [item.id, item] as const),
          ).values(),
        ]
          .sort((left, right) =>
            right.publishedAt.localeCompare(left.publishedAt),
          )
          .slice(0, MAX_HISTORICAL_NEWS);
        timelineNewsByEvent[event.id] = [event, ...historical];
      }
      return {
        ...result,
        timelineNewsByEvent,
        featuredEventIds: featured.map((item) => item.id),
        warnings,
      };
    }

    const selectedEvent = await this.loadBaseEvent(
      params.userId,
      {
        runId: input.baseRunId,
        snapshotId: input.baseSnapshotId,
      },
      input.eventId as string,
    );
    const news = [selectedEvent];
    let tracedDays = 0;
    const warnings: string[] = [];
    if (input.mode === "trace") {
      let cursor = new Date(input.traceCursor ?? selectedEvent.publishedAt);
      const windows = Math.ceil(input.traceMaxDays / 30);
      const maxHistoricalEvents = Math.min(
        MAX_HISTORICAL_NEWS,
        Math.max(0, input.traceMaxEvents - 1),
      );
      const selectedTime = new Date(selectedEvent.publishedAt).getTime();
      const seen = new Set(news.map((item) => item.id));
      for (
        let index = 0;
        index < windows && news.length - 1 < maxHistoricalEvents;
        index += 1
      ) {
        try {
          const batch = await this.deps.dataClient.getNewsRadar({
            days: TRACE_WINDOW_DAYS,
            limit: Math.min(30, maxHistoricalEvents - (news.length - 1)),
            endAt: cursor.toISOString(),
            companies: context.companies,
            industries: context.industries,
            includeMacro: false,
            traceAnchor: traceAnchor(selectedEvent),
          });
          for (const item of batch) {
            if (
              news.length - 1 >= maxHistoricalEvents ||
              seen.has(item.id) ||
              new Date(item.publishedAt).getTime() >= selectedTime
            ) {
              continue;
            }
            seen.add(item.id);
            news.push(item);
          }
          tracedDays += TRACE_WINDOW_DAYS;
        } catch (error) {
          warnings.push(
            `trace_window_failed:${error instanceof Error ? error.message : String(error)}`,
          );
        }
        cursor = new Date(cursor.getTime() - TRACE_WINDOW_DAYS * 86_400_000);
      }
    }

    const web = await this.collectWebEvidence(selectedEvent).catch((error) => {
      warnings.push(
        `relationship_search_failed:${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    });
    const historical = news
      .filter((item) => item.id !== selectedEvent.id)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, MAX_HISTORICAL_NEWS);
    return {
      news: [selectedEvent, ...historical],
      selectedEvent,
      web,
      warnings,
      tracedDays,
    };
  }

  async persistObservations(params: {
    userId: string;
    runId: string;
    collected: ImpactCollectedEvidence;
  }): Promise<PersistedImpactEvidence> {
    const now = new Date().toISOString();
    const itemIdBySourceId: Record<string, string> = {};
    const timelineNews = Object.values(
      params.collected.timelineNewsByEvent ?? {},
    ).flat();
    const uniqueNews = [
      ...new Map(
        [...params.collected.news, ...timelineNews].map((news) => [
          news.id,
          news,
        ]),
      ).values(),
    ];
    const newsItems = uniqueNews.map((news) => {
      const id = randomUUID();
      itemIdBySourceId[news.id] = id;
      return {
        id,
        itemKey: `news:${news.id}`,
        status:
          news.analysisStatus === "partial"
            ? ("partial" as const)
            : ("available" as const),
        extractedFact: news.summary,
        snippet: news.content ?? news.summary,
        valueJson: {
          title: news.title,
          summary: news.summary,
          attributions: news.attributions,
          relatedStocks: news.relatedStocks,
        },
        rawValueJson: news,
        sourceType: `minishare:${news.sourceKind ?? "fast"}`,
        sourceId: news.id,
        sourceName: news.source,
        url: news.url,
        publishedAt: news.publishedAt,
        fetchedAt: now,
        warnings: news.warnings ?? [],
        limitations:
          news.analysisStatus === "partial" ? ["news_analysis_partial"] : [],
        metadata: {
          eventType: news.eventType,
          relevanceScore: news.relevanceScore,
        },
        recordKind: "observation" as const,
        lineageId: `impact-event:${news.id}`,
        derivedFromItemIds: [],
        contentHash: hash(news),
      };
    });
    const webItems = params.collected.web.map((web) => {
      const id = randomUUID();
      itemIdBySourceId[web.id] = id;
      return {
        id,
        itemKey: `web:${web.id}`,
        status: "available" as const,
        extractedFact: web.description,
        snippet: web.description,
        valueJson: web,
        rawValueJson: web,
        sourceType: "web_search",
        sourceId: web.id,
        sourceName: new URL(web.url).hostname,
        url: web.url,
        fetchedAt: now,
        warnings: [],
        limitations: [],
        metadata: {},
        recordKind: "observation" as const,
        lineageId: `impact-web:${web.id}`,
        derivedFromItemIds: [],
        contentHash: hash(web),
      };
    });
    const context = await this.deps.evidenceRepository.create({
      userId: params.userId,
      workflowRunId: params.runId,
      context: {
        subject: { subjectType: "impact_mapping", subjectId: params.runId },
        phase: "observation",
        metadata: { mode: "impact_mapping" },
        blocks: [
          {
            id: randomUUID(),
            blockKey: "news",
            status:
              params.collected.warnings.length > 0 ? "partial" : "available",
            sourceType: "mixed_news",
            sourceName: "Minishare 与公开网页",
            fetchedAt: now,
            warnings: params.collected.warnings,
            limitations: [],
            metadata: {},
            items: [...newsItems, ...webItems],
          },
        ],
      },
    });
    return {
      contextId: context.id,
      itemIdBySourceId,
      evidenceItemIds: [...newsItems, ...webItems].map((item) => item.id),
    };
  }

  buildRadarEvents(params: {
    context: ImpactContext;
    collected: ImpactCollectedEvidence;
    persisted: PersistedImpactEvidence;
  }): ImpactRadarEvent[] {
    return params.collected.news
      .map((event) => {
        const evidenceId = params.persisted.itemIdBySourceId[event.id];
        const edges = this.buildDeterministicEdges(
          event,
          params.context,
          evidenceId,
        );
        const portfolioHits = unique(
          edges
            .filter((edge) => edge.level === "portfolio")
            .map((edge) => edge.target),
        );
        return {
          event,
          impactEdges: edges,
          portfolioHits,
          importanceScore: Math.round(
            Math.min(
              100,
              event.relevanceScore * 70 +
                edges.length * 4 +
                portfolioHits.length * 8,
            ),
          ),
        };
      })
      .sort((left, right) => right.importanceScore - left.importanceScore);
  }

  async mapDeepImpacts(params: {
    userId: string;
    runId: string;
    context: ImpactContext;
    collected: ImpactCollectedEvidence;
    persisted: PersistedImpactEvidence;
  }): Promise<{ edges: ImpactEdge[]; warnings: string[] }> {
    const selected = params.collected.selectedEvent ?? params.collected.news[0];
    if (!selected) return { edges: [], warnings: ["selected_event_missing"] };
    const fallback = {
      impactEdges: this.buildDeterministicEdges(
        selected,
        params.context,
        params.persisted.itemIdBySourceId[selected.id],
      ),
      warnings: ["impact_model_fallback"],
    };
    let response: { output: string };
    try {
      response = await this.deps.evidenceAwareLlmClient.complete({
        userId: params.userId,
        workflowRunId: params.runId,
        purpose: "impact_mapping_edges",
        policy: "evidence_required",
        evidenceItemIds: params.persisted.evidenceItemIds,
        fallbackText: JSON.stringify(fallback),
        options: { model: "deepseek-v4-flash", maxOutputTokens: 3200 },
        messages: [
          {
            role: "system",
            content:
              "你是 Impact Mapping Agent。只输出 JSON。按 primary、secondary、tertiary、macro、portfolio 五层输出影响边；不得把推断写成事实。全球实体可以保留名称，A股必须尽量映射六位代码。",
          },
          {
            role: "user",
            content: JSON.stringify({
              event: selected,
              relationshipEvidence: params.collected.web,
              companies: params.context.companies,
              industries: params.context.industries,
              portfolio: params.context.portfolio,
              watchLists: params.context.watchLists,
              hypotheses: params.context.hypotheses,
              schema: {
                impactEdges:
                  "id, level, source, target, targetType, stockCode?, relation, direction, strength, confidence, rationale, evidenceItemIds, basis, hypothesisStatus?",
                warnings: "string[]",
              },
            }),
          },
        ],
      });
    } catch {
      return { edges: fallback.impactEdges, warnings: fallback.warnings };
    }
    const parsed = impactOutputSchema.safeParse(parseJson(response.output));
    if (!parsed.success) {
      return { edges: fallback.impactEdges, warnings: fallback.warnings };
    }
    const allowed = new Set(params.persisted.evidenceItemIds);
    return {
      edges: parsed.data.impactEdges.map((edge) => ({
        ...edge,
        evidenceItemIds: edge.evidenceItemIds.filter((id) => allowed.has(id)),
      })),
      warnings: parsed.data.warnings,
    };
  }

  buildTimeline(params: {
    collected: ImpactCollectedEvidence;
    persisted: PersistedImpactEvidence;
  }): ImpactTimelineItem[] {
    return (params.collected.timelineNews ?? params.collected.news)
      .map((event) => ({
        id: randomUUID(),
        occurredAt: event.publishedAt,
        title: event.title,
        summary: event.summary,
        eventId: event.id,
        url: event.url,
        source: event.source,
        evidenceItemIds: [params.persisted.itemIdBySourceId[event.id]].filter(
          (value): value is string => Boolean(value),
        ),
        kind: "observed" as const,
      }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }

  async forecastScenarios(params: {
    userId: string;
    runId: string;
    context: ImpactContext;
    collected: ImpactCollectedEvidence;
    persisted: PersistedImpactEvidence;
    edges: ImpactEdge[];
  }): Promise<{ scenarios: ImpactScenario[]; warnings: string[] }> {
    const event = params.collected.selectedEvent ?? params.collected.news[0];
    if (!event) return { scenarios: [], warnings: ["selected_event_missing"] };
    const fallback = {
      scenarios: fallbackScenarios(event, params.persisted.evidenceItemIds),
      warnings: ["scenario_model_fallback"],
    };
    let response: { output: string };
    try {
      response = await this.deps.evidenceAwareLlmClient.complete({
        userId: params.userId,
        workflowRunId: params.runId,
        purpose: "impact_mapping_scenarios",
        policy: "evidence_required",
        evidenceItemIds: params.persisted.evidenceItemIds,
        fallbackText: JSON.stringify(fallback),
        options: { model: "deepseek-v4-flash", maxOutputTokens: 2200 },
        messages: [
          {
            role: "system",
            content:
              "基于给定事实生成 2 到 5 条未来分支，只输出 JSON。禁止输出精确概率；每条必须区分推断或假设。",
          },
          {
            role: "user",
            content: JSON.stringify({
              event,
              impactEdges: params.edges,
              hypotheses: params.context.hypotheses,
              schema: {
                scenarios:
                  "2-5 items: id, name, horizon, triggers[], confirmationSignals[], invalidationConditions[], affectedTargets[], rationale, evidenceItemIds[], basis(inference|assumption)",
                warnings: "string[]",
              },
            }),
          },
        ],
      });
    } catch {
      return fallback;
    }
    const parsed = scenarioOutputSchema.safeParse(parseJson(response.output));
    if (!parsed.success) return fallback;
    const allowed = new Set(params.persisted.evidenceItemIds);
    return {
      ...parsed.data,
      scenarios: parsed.data.scenarios.map((scenario) => ({
        ...scenario,
        evidenceItemIds: scenario.evidenceItemIds.filter((id) =>
          allowed.has(id),
        ),
      })),
    };
  }

  async persistDerived(params: {
    userId: string;
    runId: string;
    persisted: PersistedImpactEvidence;
    edges: ImpactEdge[];
    scenarios: ImpactScenario[];
  }): Promise<EvidenceCitation[]> {
    const now = new Date().toISOString();
    const items = [
      ...params.edges.map((edge) => ({
        id: randomUUID(),
        itemKey: `impact-edge:${edge.id}`,
        status: "available" as const,
        extractedFact: edge.rationale,
        snippet: `${edge.source} -> ${edge.target}`,
        valueJson: edge,
        sourceType: "impact_mapping_agent",
        sourceId: edge.id,
        sourceName: "Impact Mapping Agent",
        observedAt: now,
        warnings: [],
        limitations: edge.basis === "fact" ? [] : ["model_derived"],
        metadata: { level: edge.level, basis: edge.basis },
        recordKind: "model_derived" as const,
        lineageId: `impact-edge:${edge.id}`,
        derivedFromItemIds: edge.evidenceItemIds,
        algorithmVersion: "impact-mapping-v1",
        parameters: {},
        contentHash: hash(edge),
      })),
      ...params.scenarios.map((scenario) => ({
        id: randomUUID(),
        itemKey: `impact-scenario:${scenario.id}`,
        status: "estimated" as const,
        extractedFact: scenario.rationale,
        snippet: scenario.name,
        valueJson: scenario,
        sourceType: "impact_mapping_agent",
        sourceId: scenario.id,
        sourceName: "Impact Mapping Agent",
        observedAt: now,
        warnings: [],
        limitations: ["forward_looking_scenario", "not_probability"],
        metadata: { horizon: scenario.horizon, basis: scenario.basis },
        recordKind: "model_derived" as const,
        lineageId: `impact-scenario:${scenario.id}`,
        derivedFromItemIds: params.persisted.evidenceItemIds,
        algorithmVersion: "impact-mapping-v1",
        parameters: {},
        contentHash: hash(scenario),
      })),
    ];
    await this.deps.evidenceRepository.create({
      userId: params.userId,
      workflowRunId: params.runId,
      context: {
        subject: { subjectType: "impact_mapping", subjectId: params.runId },
        phase: "analysis",
        metadata: { parentContextId: params.persisted.contextId },
        blocks: [
          {
            id: randomUUID(),
            blockKey: "impact_mapping",
            status: "available",
            sourceType: "model_derived",
            sourceName: "Impact Mapping Agent",
            observedAt: now,
            warnings: [],
            limitations: [],
            metadata: {},
            items,
          },
        ],
      },
    });
    return unique(params.persisted.evidenceItemIds).map((evidenceItemId) => ({
      evidenceItemId,
      relation: "support" as const,
    }));
  }

  buildResult(params: {
    input: ImpactMappingInput;
    context: ImpactContext;
    collected: ImpactCollectedEvidence;
    radarEvents: ImpactRadarEvent[];
    edges: ImpactEdge[];
    timeline: ImpactTimelineItem[];
    scenarios: ImpactScenario[];
    citations: EvidenceCitation[];
    warnings: string[];
  }): ImpactMappingResult {
    const warnings = unique([...params.collected.warnings, ...params.warnings]);
    const oldest = params.timeline[0]?.occurredAt;
    return {
      mode: params.input.mode,
      analysisStatus:
        warnings.length > 0 ||
        params.collected.news.some((item) => item.analysisStatus === "partial")
          ? "partial"
          : "complete",
      asOf: new Date().toISOString(),
      context: params.context,
      events: params.radarEvents,
      selectedEvent: params.collected.selectedEvent,
      impactEdges: params.edges,
      timeline: params.timeline,
      scenarios: params.scenarios,
      evidenceCitations: params.citations,
      warnings,
      featuredEventIds: params.collected.featuredEventIds,
      traceState:
        params.input.mode === "trace"
          ? {
              oldestOccurredAt: oldest,
              tracedDays: params.collected.tracedDays,
              eventCount: params.timeline.length,
              canContinue:
                params.collected.tracedDays >= params.input.traceMaxDays ||
                params.timeline.length >= params.input.traceMaxEvents,
            }
          : undefined,
    };
  }

  private async loadBaseEvent(
    userId: string,
    source: { runId?: string; snapshotId?: string },
    eventId: string,
  ) {
    let value: unknown;
    if (source.runId) {
      const run = await this.deps.prisma.workflowRun.findFirst({
        where: { id: source.runId, userId },
        select: { result: true },
      });
      value = run?.result;
    } else if (source.snapshotId) {
      const snapshot = await this.deps.prisma.homePageSnapshot.findFirst({
        where: {
          id: source.snapshotId,
          OR: [{ scope: "DEFAULT" }, { userId }],
        },
        select: { payload: true },
      });
      value = asObject(snapshot?.payload).impactMapping;
    }
    const result = asObject(value) as Partial<ImpactMappingResult>;
    const event =
      result.events?.find((item) => item.event.id === eventId)?.event ??
      (result.selectedEvent?.id === eventId ? result.selectedEvent : undefined);
    if (!event) throw new Error("基准运行中不存在指定事件");
    return event;
  }

  private async collectWebEvidence(
    event: ThemeNewsItem,
  ): Promise<WebEvidence[]> {
    const queries = unique([
      `${event.title} 供应商 客户 竞争对手`,
      `${event.title} 替代技术 地区 商品`,
    ]);
    const batches = await Promise.all(
      queries.map((query) =>
        this.deps.capabilityClient.search({ query, limit: 4 }),
      ),
    );
    const byUrl = new Map<string, WebEvidence>();
    for (const item of batches.flat()) {
      if (!byUrl.has(item.url)) {
        byUrl.set(item.url, {
          id: hash(item.url).slice(0, 24),
          title: item.title,
          url: item.url,
          description: item.description ?? item.markdown?.slice(0, 1000) ?? "",
        });
      }
    }
    return [...byUrl.values()].slice(0, 8);
  }

  private buildDeterministicEdges(
    event: ThemeNewsItem,
    context: ImpactContext,
    evidenceItemId?: string,
  ): ImpactEdge[] {
    const evidenceItemIds = evidenceItemId ? [evidenceItemId] : [];
    const edges: ImpactEdge[] = [];
    for (const attribution of event.attributions ?? []) {
      edges.push({
        id: randomUUID(),
        level: attribution.targetType === "macro" ? "macro" : "primary",
        source: event.title,
        target: attribution.targetName,
        targetType: attribution.targetType,
        stockCode: attribution.targetId?.match(/^\d{6}$/)?.[0],
        relation: attribution.relation,
        direction:
          event.sentiment === "neutral" ? "uncertain" : event.sentiment,
        strength:
          attribution.confidence >= 0.8
            ? "high"
            : attribution.confidence >= 0.6
              ? "medium"
              : "low",
        confidence: attribution.confidence,
        rationale: attribution.reason || event.matchReason,
        evidenceItemIds,
        basis: "fact",
      });
    }
    const portfolioCodes = new Map(
      (context.portfolio?.positions ?? []).map((position) => [
        position.stockCode,
        position.stockName,
      ]),
    );
    const watchCodes = new Map(
      context.watchLists
        .flatMap((watchList) => watchList.stocks)
        .map((stock) => [stock.stockCode, stock.stockName]),
    );
    for (const stockCode of event.relatedStocks) {
      const target = portfolioCodes.get(stockCode) ?? watchCodes.get(stockCode);
      if (!target) continue;
      edges.push({
        id: randomUUID(),
        level: "portfolio",
        source: event.title,
        target,
        targetType: portfolioCodes.has(stockCode) ? "holding" : "watchlist",
        stockCode,
        relation: "证券代码命中",
        direction:
          event.sentiment === "neutral" ? "uncertain" : event.sentiment,
        strength: portfolioCodes.has(stockCode) ? "high" : "medium",
        confidence: 1,
        rationale: portfolioCodes.has(stockCode)
          ? "事件归属证券命中当前组合持仓。"
          : "事件归属证券命中所选自选股。",
        evidenceItemIds,
        basis: "fact",
      });
    }
    if (edges.length === 0) {
      edges.push({
        id: randomUUID(),
        level: "macro",
        source: event.title,
        target: event.eventType || "市场环境",
        targetType: "macro",
        relation: "待验证影响",
        direction: "uncertain",
        strength: "low",
        confidence: event.relevanceScore,
        rationale:
          event.matchReason || "新闻已召回，但尚无可验证的直接实体归属。",
        evidenceItemIds,
        basis: "inference",
      });
    }
    return edges;
  }
}
