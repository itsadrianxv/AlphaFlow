import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImpactMappingResult } from "~/server/domain/intelligence/impact-mapping";

const mocks = vi.hoisted(() => ({
  latest: undefined as
    | {
        id: string;
        result: ImpactMappingResult;
      }
    | undefined,
  latestLoading: false,
  mutate: vi.fn(),
}));

const workspaceSource = readFileSync(
  "app/_components/impact-mapping-workspace.tsx",
  "utf8",
);

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      workflow: {
        getLatestImpactMapping: { invalidate: vi.fn() },
        getRun: { invalidate: vi.fn() },
      },
    }),
    workflow: {
      getLatestImpactMapping: {
        useQuery: () => ({
          data: mocks.latest,
          isLoading: mocks.latestLoading,
        }),
      },
      getRun: {
        useQuery: () => ({ data: undefined }),
      },
      startImpactMapping: {
        useMutation: () => ({
          mutate: mocks.mutate,
          isPending: false,
        }),
      },
      ensureImpactMappingAnalyses: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
    watchlist: {
      list: {
        useQuery: () => ({
          data: [
            {
              id: "watch-1",
              name: "核心自选",
              stockCount: 12,
            },
          ],
        }),
      },
    },
    timing: {
      listPortfolioCompositions: {
        useQuery: () => ({
          data: [{ id: "portfolio-1", name: "主组合" }],
        }),
      },
    },
    evidenceContext: {
      getItem: { useQuery: () => ({ data: undefined, isLoading: false }) },
      lineage: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

vi.mock("~/app/_components/home-page-snapshot-provider", () => ({
  useHomePageSnapshot: () => ({
    data: mocks.latest
      ? {
          snapshotId: mocks.latest.id,
          generatedAt: "2026-07-24T08:30:00.000Z",
          payload: { impactMapping: mocks.latest.result },
        }
      : undefined,
    isLoading: mocks.latestLoading,
    isError: false,
  }),
}));

import {
  buildEvidenceOrdinals,
  ImpactMappingWorkspace,
  isNewsSnapshotFresh,
} from "~/app/_components/impact-mapping-workspace";

const radarResult: ImpactMappingResult = {
  mode: "radar",
  analysisStatus: "complete",
  asOf: "2026-07-24T08:00:00.000Z",
  context: {
    watchLists: [],
    companies: [],
    industries: [],
    hypotheses: [],
  },
  events: [
    {
      event: {
        id: "event-1",
        title: "先进制程设备投资加速",
        summary: "产业链资本开支预期上修。",
        content: "这是完整的 major_news 正文。",
        source: "财联社",
        sourceKind: "major",
        publishedAt: "2026-07-24T07:00:00.000Z",
        sentiment: "positive",
        relevanceScore: 0.92,
        relatedStocks: ["688012.SH"],
        scopeTags: ["industry", "company"],
        eventType: "capital_expenditure",
        matchReason: "命中半导体设备与组合持仓",
        analysisStatus: "complete",
        warnings: [],
      },
      impactEdges: [
        {
          id: "edge-1",
          level: "portfolio",
          source: "event-1",
          target: "中微公司",
          targetType: "company",
          stockCode: "688012",
          relation: "组合持仓",
          direction: "positive",
          strength: "high",
          confidence: 0.94,
          rationale: "资本开支上修可能带动设备订单。",
          evidenceItemIds: [],
          basis: "inference",
        },
      ],
      portfolioHits: ["中微公司"],
      importanceScore: 94,
    },
  ],
  impactEdges: [],
  timeline: [],
  scenarios: [],
  evidenceCitations: [],
  warnings: [],
};

const overviewResult: ImpactMappingResult = {
  ...radarResult,
  mode: "overview",
  featuredEventIds: ["event-1"],
  events: radarResult.events.map((item) => ({
    ...item,
    analysis: {
      timeline: [
        {
          id: "timeline-1",
          occurredAt: "2026-07-20T07:00:00.000Z",
          title: "此前的产业链订单信号",
          summary: "订单与资本开支的变化为当前新闻提供背景。",
          eventId: "history-1",
          evidenceItemIds: [],
          kind: "observed",
        },
      ],
      scenarios: [
        {
          id: "scenario-1",
          name: "订单兑现",
          horizon: "未来一季",
          triggers: ["设备订单增长"],
          confirmationSignals: ["公司披露新增订单"],
          invalidationConditions: ["资本开支下调"],
          affectedTargets: ["中微公司"],
          rationale: "订单兑现将验证当前的影响判断。",
          evidenceItemIds: ["evidence-1"],
          basis: "inference",
        },
      ],
      traceState: {
        oldestOccurredAt: "2026-07-20T07:00:00.000Z",
        tracedDays: 360,
        eventCount: 1,
        canContinue: true,
      },
      warnings: [],
    },
  })),
};

describe("ImpactMappingWorkspace", () => {
  beforeEach(() => {
    mocks.latest = undefined;
    mocks.latestLoading = false;
    mocks.mutate.mockReset();
  });

  it("未登录时不渲染新闻区域", () => {
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: false }),
    );

    expect(html).toBe("");
  });

  it("自动展示 carousel 下方的横向时间轴与影响分析", () => {
    mocks.latest = { id: "run-overview-1", result: overviewResult };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain('data-testid="impact-news-carousel"');
    expect(html).toContain('data-testid="impact-news-analysis"');
    expect(html).toContain('data-testid="impact-news-timeline"');
    expect(html).toContain('data-testid="impact-timeline-tooltip"');
    expect(html).toContain("先进制程设备投资加速");
    expect(html).toContain("组合命中 1");
    expect(html).toContain("此前的产业链订单信号");
    expect(html).toContain("订单与资本开支的变化为当前新闻提供背景。");
    expect(html).toContain("资本开支上修可能带动设备订单");
    expect(html).toContain("订单兑现");
    for (const removed of [
      "新闻影响雷达",
      "个事件 · 快照",
      "最近更新的组合",
      "新闻窗口",
      "刷新雷达",
      "核心自选",
      "部分能力未完成，已保留可验证结果",
      "深挖影响",
      "往前追溯",
      "查看分析",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  it("所有尺寸使用同一条横向时间轴，并通过悬浮或聚焦展示摘要", () => {
    expect(workspaceSource).toContain('data-testid="impact-news-timeline"');
    expect(workspaceSource).toContain("h-[26rem] min-w-max");
    expect(workspaceSource).toContain("group-hover:opacity-100");
    expect(workspaceSource).toContain("group-focus-within:opacity-100");
    expect(workspaceSource).not.toContain("md:hidden");
    expect(workspaceSource).not.toContain("TimelineEventNode entry={entry} compact");
  });

  it("partial 快照不展示 warning 区域", () => {
    mocks.latest = {
      id: "run-radar-partial",
      result: {
        ...overviewResult,
        analysisStatus: "partial",
        warnings: ["cctv_news 暂时不可用"],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain("先进制程设备投资加速");
    expect(html).not.toContain("部分能力未完成，已保留可验证结果");
    expect(html).not.toContain("cctv_news 暂时不可用");
  });

  it("旧快照也只展示最近五条历史新闻", () => {
    const baseEvent = overviewResult.events[0]!;
    const historical = Array.from({ length: 7 }, (_, index) => ({
      id: `legacy-timeline-${index}`,
      occurredAt: `2026-07-${String(23 - index).padStart(2, "0")}T07:00:00.000Z`,
      title: `旧快照历史新闻 ${index}`,
      summary: `不应展示的摘要 ${index}`,
      eventId: `legacy-history-${index}`,
      evidenceItemIds: [],
      kind: "observed" as const,
    }));
    mocks.latest = {
      id: "run-overview-legacy",
      result: {
        ...overviewResult,
        events: [
          {
            ...baseEvent,
            analysis: {
              ...baseEvent.analysis!,
              timeline: [
                ...historical,
                {
                  ...historical[0]!,
                  id: "current-timeline",
                  occurredAt: baseEvent.event.publishedAt,
                  title: baseEvent.event.title,
                  eventId: baseEvent.event.id,
                },
              ],
            },
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain("旧快照历史新闻 4");
    expect(html).not.toContain("旧快照历史新闻 5");
    expect(html).toContain("不应展示的摘要 4");
    expect(html).not.toContain("不应展示的摘要 5");
  });

  it("不接纳缺少自动分析的旧 radar 快照", () => {
    mocks.latest = { id: "run-radar-1", result: radarResult };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toBe("");
  });

  it("最近影响映射只接纳 overview 结果", () => {
    const routerSource = readFileSync(
      "server/api/routers/workflow.ts",
      "utf8",
    );

    expect(routerSource).toContain('input.mode === "overview"');
    expect(routerSource).toContain("hasNonEmptyImpactEvents(run.result)");
    expect(routerSource).toContain("ensureImpactMappingAnalyses");
    expect(routerSource).toContain("新闻雷达基准快照不存在");
    expect(routerSource).toContain("availableEventIds.has(eventId)");
    expect(routerSource).toContain(
      "impact-analysis:${sourceKind}:${sourceId}:${eventId}",
    );
  });

  it("按首次出现顺序为证据去重编号", () => {
    expect(
      buildEvidenceOrdinals({
        impactEdges: [
          {
            ...overviewResult.events[0]!.impactEdges[0]!,
            evidenceItemIds: ["evidence-b", "evidence-c"],
          },
        ],
        timeline: [
          {
            ...overviewResult.events[0]!.analysis!.timeline[0]!,
            evidenceItemIds: ["evidence-a", "evidence-b"],
          },
        ],
        scenarios: [
          {
            ...overviewResult.events[0]!.analysis!.scenarios[0]!,
            evidenceItemIds: ["evidence-c", "evidence-d"],
          },
        ],
        warnings: [],
      }),
    ).toEqual({
      "evidence-a": 1,
      "evidence-b": 2,
      "evidence-c": 3,
      "evidence-d": 4,
    });
  });

  it("无快照时不渲染空状态或控制项", () => {
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toBe("");
  });

  it("不使用零事件 overview 覆盖可用新闻流", () => {
    mocks.latest = {
      id: "run-overview-empty",
      result: { ...overviewResult, events: [] },
    };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toBe("");
  });

  it("新闻快照严格按一小时判断新鲜度", () => {
    const completedAt = "2026-07-25T04:00:00.000Z";
    expect(isNewsSnapshotFresh(completedAt, Date.parse("2026-07-25T04:59:59.000Z"))).toBe(true);
    expect(isNewsSnapshotFresh(completedAt, Date.parse("2026-07-25T05:00:00.000Z"))).toBe(false);
  });
});
