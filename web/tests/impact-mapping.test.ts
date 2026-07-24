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

  it("追溯按 30 天窗口执行并限制为 30 个事件", async () => {
    const historical = Array.from({ length: 8 }, (_, index) => ({
      ...event,
      id: `historical-${index}`,
      title: `历史事件 ${index}`,
      publishedAt: `2026-0${Math.max(1, 6 - index)}-01T10:00:00+08:00`,
    }));
    const getNewsRadar = vi.fn(async () => historical);
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

    expect(getNewsRadar).toHaveBeenCalledTimes(4);
    expect(result.news.length).toBeLessThanOrEqual(30);
    expect(result.tracedDays).toBe(120);
  });
});
