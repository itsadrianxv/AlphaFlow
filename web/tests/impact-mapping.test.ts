import { describe, expect, it, vi } from "vitest";
import {
  ImpactMappingService,
  type ImpactCollectedEvidence,
  type PersistedImpactEvidence,
} from "~/server/application/intelligence/impact-mapping-service";
import {
  impactMappingInputSchema,
  type ImpactContext,
  type ImpactMappingResult,
} from "~/server/domain/intelligence/impact-mapping";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";
import { ImpactMappingLangGraph } from "~/server/infrastructure/workflow/langgraph/impact-mapping-graph";

const event: ThemeNewsItem = {
  id: "event-1",
  title: "算力资本开支扩大",
  summary: "产业链扩产",
  content: "算力资本开支扩大，603019 参与相关建设。",
  source: "minishare:major",
  sourceKind: "major",
  publishedAt: "2026-07-24T10:00:00+08:00",
  sentiment: "positive",
  relevanceScore: 0.9,
  relatedStocks: ["603019"],
  scopeTags: ["industry"],
  eventType: "资本开支",
  matchReason: "算力行业相关",
  analysisStatus: "complete",
  warnings: [],
};

const context: ImpactContext = {
  portfolio: {
    id: "portfolio-1",
    name: "主组合",
    positions: [
      { stockCode: "603019", stockName: "中科曙光", currentWeightPct: 12 },
    ],
  },
  watchLists: [],
  companies: [
    {
      stockCode: "603019",
      companyName: "中科曙光",
      aliases: ["中科曙光"],
    },
  ],
  industries: [{ name: "算力", aliases: ["AI算力"] }],
  hypotheses: [],
};

const collected: ImpactCollectedEvidence = {
  news: [event],
  web: [],
  warnings: [],
  tracedDays: 7,
};

const persisted: PersistedImpactEvidence = {
  contextId: "context-1",
  itemIdBySourceId: { "event-1": "evidence-1" },
  evidenceItemIds: ["evidence-1"],
};

describe("Impact Mapping", () => {
  it("要求深挖和追溯提供基准运行与事件", () => {
    expect(
      impactMappingInputSchema.safeParse({ mode: "deep_dive" }).success,
    ).toBe(false);
    expect(
      impactMappingInputSchema.safeParse({
        mode: "trace",
        eventId: "event-1",
        baseRunId: "clx1234567890123456789012",
        traceMaxDays: 365,
        traceMaxEvents: 30,
      }).success,
    ).toBe(true);
    expect(
      impactMappingInputSchema.safeParse({ mode: "overview" }).success,
    ).toBe(true);
  });

  it("在本地将新闻证券代码命中当前持仓", () => {
    const service = new ImpactMappingService({} as never);
    const radar = service.buildRadarEvents({ context, collected, persisted });
    const portfolioEdge = radar[0]?.impactEdges.find(
      (edge) => edge.level === "portfolio",
    );

    expect(portfolioEdge?.stockCode).toBe("603019");
    expect(portfolioEdge?.target).toBe("中科曙光");
    expect(portfolioEdge?.basis).toBe("fact");
  });

  it("没有组合时将宏观分析中的全部候选股作为虚拟组合", async () => {
    const service = new ImpactMappingService({
      prisma: {
        portfolioSnapshot: { findFirst: vi.fn(async () => null) },
        watchList: { findMany: vi.fn(async () => []) },
        savedCompany: { findMany: vi.fn(async () => []) },
        savedIndustry: { findMany: vi.fn(async () => []) },
      },
      marketContextClient: {
        getSnapshot: vi.fn(async () => ({
          hotThemes: [
            {
              candidateStocks: [
                { stockCode: "603019", stockName: "中科曙光" },
                { stockCode: "300750", stockName: "宁德时代" },
              ],
            },
            {
              candidateStocks: [
                { stockCode: "603019", stockName: "中科曙光" },
                { stockCode: "600519", stockName: "贵州茅台" },
              ],
            },
          ],
        })),
      },
    } as never);

    const result = await service.loadContext(
      "user-1",
      impactMappingInputSchema.parse({ mode: "radar" }),
    );

    expect(result.portfolio?.name).toBe("宏观分析候选股");
    expect(result.portfolio?.positions).toEqual([
      { stockCode: "603019", stockName: "中科曙光", currentWeightPct: 100 / 3 },
      { stockCode: "300750", stockName: "宁德时代", currentWeightPct: 100 / 3 },
      { stockCode: "600519", stockName: "贵州茅台", currentWeightPct: 100 / 3 },
    ]);
    expect(result.companies.map((company) => company.stockCode)).toEqual([
      "603019",
      "300750",
      "600519",
    ]);
  });

  it("把新闻原文持久化为 observation 证据", async () => {
    const create = vi.fn(async (params) => ({
      id: "context-1",
      ...params.context,
    }));
    const service = new ImpactMappingService({
      evidenceRepository: { create },
    } as never);

    const result = await service.persistObservations({
      userId: "user-1",
      runId: "run-1",
      collected,
    });
    const input = create.mock.calls[0]?.[0];
    const item = input?.context.blocks[0]?.items[0];

    expect(result.evidenceItemIds).toHaveLength(1);
    expect(item?.recordKind).toBe("observation");
    expect(item?.rawValueJson.content).toContain("603019");
    expect(item?.lineageId).toBe("impact-event:event-1");
  });

  it("overview 将历史新闻去重后持久化并保留来源映射", async () => {
    const historical = {
      ...event,
      id: "history-1",
      title: "此前算力订单信号",
      url: "https://example.com/history-1",
    };
    const create = vi.fn(async (params) => ({
      id: "context-1",
      ...params.context,
    }));
    const service = new ImpactMappingService({
      evidenceRepository: { create },
    } as never);

    const result = await service.persistObservations({
      userId: "user-1",
      runId: "run-1",
      collected: {
        ...collected,
        timelineNewsByEvent: {
          "event-1": [event, historical, historical],
        },
      },
    });
    const items = create.mock.calls[0]?.[0]?.context.blocks[0]?.items ?? [];

    expect(items).toHaveLength(2);
    expect(result.itemIdBySourceId["event-1"]).toBeTruthy();
    expect(result.itemIdBySourceId["history-1"]).toBeTruthy();
    expect(
      items.find(
        (item: { sourceId?: string }) => item.sourceId === "history-1",
      )?.url,
    ).toBe("https://example.com/history-1");
  });

  it("时间线节点保留原文地址、来源和证据 ID", () => {
    const service = new ImpactMappingService({} as never);
    const timeline = service.buildTimeline({
      collected: {
        ...collected,
        news: [
          {
            ...event,
            url: "https://example.com/event-1",
            source: "测试来源",
          },
        ],
      },
      persisted,
    });

    expect(timeline[0]).toMatchObject({
      eventId: "event-1",
      url: "https://example.com/event-1",
      source: "测试来源",
      evidenceItemIds: ["evidence-1"],
    });
  });

  it("未来情景只保留当前事件允许引用的证据", async () => {
    const service = new ImpactMappingService({
      evidenceAwareLlmClient: {
        complete: vi.fn(async () => ({
          output: JSON.stringify({
            scenarios: [
              {
                id: "scenario-1",
                name: "订单延续",
                horizon: "未来一季",
                triggers: ["新增订单"],
                confirmationSignals: ["订单披露"],
                invalidationConditions: ["资本开支下降"],
                affectedTargets: ["中科曙光"],
                rationale: "订单延续将强化当前影响。",
                evidenceItemIds: ["evidence-1", "foreign-evidence"],
                basis: "inference",
              },
              {
                id: "scenario-2",
                name: "订单反转",
                horizon: "未来一季",
                triggers: ["需求下降"],
                confirmationSignals: ["订单下修"],
                invalidationConditions: ["新增订单超预期"],
                affectedTargets: ["中科曙光"],
                rationale: "需求下降可能使当前影响反转。",
                evidenceItemIds: ["foreign-evidence"],
                basis: "assumption",
              },
            ],
            warnings: [],
          }),
        })),
      },
    } as never);

    const result = await service.forecastScenarios({
      userId: "user-1",
      runId: "run-1",
      context,
      collected: { ...collected, selectedEvent: event },
      persisted,
      edges: [],
    });

    expect(result.scenarios.map((scenario) => scenario.evidenceItemIds)).toEqual([
      ["evidence-1"],
      [],
    ]);
  });

  it("雷达模式优先使用共享新闻库", async () => {
    const collectRadar = vi.fn(async () => ({
      news: [event],
      warnings: ["shared_news_reused"],
    }));
    const service = new ImpactMappingService({
      sharedNewsLibraryService: { collectRadar },
      dataClient: { getNewsRadar: vi.fn() },
    } as never);

    const result = await service.collectEvidence({
      userId: "user-1",
      context,
      input: impactMappingInputSchema.parse({ mode: "radar", days: 7 }),
    });

    expect(collectRadar).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }));
    expect(result.news).toEqual([event]);
    expect(result.warnings).toContain("shared_news_reused");
  });

  it("overview 新闻采集超过 600 秒时失败而不是保存空快照", async () => {
    vi.useFakeTimers();
    const service = new ImpactMappingService({
      sharedNewsLibraryService: {
        collectRadar: vi.fn(() => new Promise(() => undefined)),
      },
    } as never);

    const pending = expect(
      service.collectEvidence({
        userId: "user-1",
        context,
        input: impactMappingInputSchema.parse({ mode: "overview", days: 7 }),
      }),
    ).rejects.toThrow("radar_collect_failed:radar_collect_timeout_600000ms");

    await vi.advanceTimersByTimeAsync(600_000);
    await pending;
    vi.useRealTimers();
  });

  it("overview 首个回溯窗口紧贴当前事件并最多保留五条历史新闻", async () => {
    const historical = Array.from({ length: 8 }, (_, index) => ({
      ...event,
      id: `overview-history-${index}`,
      title: `历史事件 ${index}`,
      publishedAt: `2026-07-${String(23 - index).padStart(2, "0")}T10:00:00+08:00`,
    }));
    const collectRadar = vi.fn(
      async (request: { traceAnchor?: unknown }) =>
        request.traceAnchor
          ? { news: historical, warnings: [] }
          : { news: [event], warnings: [] },
    );
    const getNewsRadar = vi.fn();
    const service = new ImpactMappingService({
      sharedNewsLibraryService: { collectRadar },
      dataClient: { getNewsRadar },
    } as never);

    const result = await service.collectEvidence({
      userId: "user-1",
      context,
      input: impactMappingInputSchema.parse({ mode: "overview", days: 7 }),
    });

    expect(collectRadar).toHaveBeenCalledTimes(13);
    expect(getNewsRadar).not.toHaveBeenCalled();
    expect(collectRadar.mock.calls[1]?.[0]).toMatchObject({
      days: 30,
      endAt: "2026-07-24T02:00:00.000Z",
      includeMacro: false,
      traceAnchor: {
        title: event.title,
        eventType: event.eventType,
        relatedStocks: event.relatedStocks,
      },
    });
    expect(result.timelineNewsByEvent?.[event.id]).toHaveLength(6);
    expect(result.timelineNewsByEvent?.[event.id]?.[0]?.id).toBe(event.id);
  });

  it("雷达图跳过时间线和未来分支并产出快照", async () => {
    const radarEvents = [
      {
        event,
        impactEdges: [],
        portfolioHits: ["中科曙光"],
        importanceScore: 92,
      },
    ];
    const expectedResult: ImpactMappingResult = {
      mode: "radar",
      analysisStatus: "complete",
      asOf: "2026-07-24T12:00:00.000Z",
      context,
      events: radarEvents,
      impactEdges: [],
      timeline: [],
      scenarios: [],
      evidenceCitations: [{ evidenceItemId: "evidence-1" }],
      warnings: [],
    };
    const service = {
      loadContext: vi.fn(async () => context),
      collectEvidence: vi.fn(async () => collected),
      persistObservations: vi.fn(async () => persisted),
      buildRadarEvents: vi.fn(() => radarEvents),
      mapDeepImpacts: vi.fn(),
      buildTimeline: vi.fn(),
      forecastScenarios: vi.fn(),
      persistDerived: vi.fn(async () => [
        { evidenceItemId: "evidence-1", relation: "support" as const },
      ]),
      buildResult: vi.fn(() => expectedResult),
    };
    const graph = new ImpactMappingLangGraph(service as never);
    const finalState = await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-1",
        userId: "user-1",
        query: "影响映射 radar",
        input: { mode: "radar", days: 7 },
        progressPercent: 0,
      }),
    });

    expect(service.buildTimeline).not.toHaveBeenCalled();
    expect(service.forecastScenarios).not.toHaveBeenCalled();
    expect(graph.getRunResult(finalState)).toEqual(expectedResult);
  });

  it("追溯首窗紧贴当前事件并限制为五条历史新闻", async () => {
    const historical = Array.from({ length: 8 }, (_, index) => ({
      ...event,
      id: `historical-${index}`,
      title: `历史事件 ${index}`,
      publishedAt: `2026-0${Math.max(1, 6 - index)}-01T10:00:00+08:00`,
    }));
    const getNewsRadar = vi.fn(async (_request: unknown) => historical);
    const service = new ImpactMappingService({
      prisma: {
        workflowRun: {
          findFirst: vi.fn(async () => ({
            result: {
              events: [
                {
                  event,
                  impactEdges: [],
                  portfolioHits: [],
                  importanceScore: 90,
                },
              ],
            },
          })),
        },
      },
      dataClient: { getNewsRadar },
      capabilityClient: { search: vi.fn(async () => []) },
    } as never);

    const result = await service.collectEvidence({
      userId: "user-1",
      context,
      input: impactMappingInputSchema.parse({
        mode: "trace",
        eventId: "event-1",
        baseRunId: "clx1234567890123456789012",
        traceMaxDays: 365,
        traceMaxEvents: 30,
      }),
    });

    expect(getNewsRadar).toHaveBeenCalledTimes(1);
    expect(getNewsRadar.mock.calls[0]?.[0]).toMatchObject({
      days: 30,
      endAt: "2026-07-24T02:00:00.000Z",
      includeMacro: false,
      traceAnchor: { title: event.title },
    });
    expect(result.news).toHaveLength(6);
    expect(result.tracedDays).toBe(30);
  });
});
