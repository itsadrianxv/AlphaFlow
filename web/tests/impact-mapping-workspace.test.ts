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
      listPortfolioSnapshots: {
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

import { ImpactMappingWorkspace } from "~/app/_components/impact-mapping-workspace";

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

describe("ImpactMappingWorkspace", () => {
  beforeEach(() => {
    mocks.latest = undefined;
    mocks.latestLoading = false;
    mocks.mutate.mockReset();
  });

  it("未登录时只展示登录提示，不读取私有结果", () => {
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: false }),
    );

    expect(html).toContain("新闻影响雷达");
    expect(html).toContain("登录后可读取组合、自选和最近成功的影响映射快照");
    expect(html).not.toContain("刷新雷达");
  });

  it("优先渲染最近成功快照、组合命中和完整正文", () => {
    mocks.latest = { id: "run-radar-1", result: radarResult };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain("1 个事件");
    expect(html).toContain("先进制程设备投资加速");
    expect(html).toContain("组合命中 1");
    expect(html).toContain("组合影响");
    expect(html).toContain("这是完整的 major_news 正文");
    expect(html).toContain("深挖影响");
    expect(html).toContain("往前追溯");
    expect(html).toContain("事件");
    expect(html).toContain("影响");
  });

  it("partial 快照明确展示缺失能力和 warning", () => {
    mocks.latest = {
      id: "run-radar-partial",
      result: {
        ...radarResult,
        analysisStatus: "partial",
        warnings: ["cctv_news 暂时不可用"],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain("部分能力未完成，已保留可验证结果");
    expect(html).toContain("cctv_news 暂时不可用");
    expect(html).toContain("部分完成");
  });

  it("无快照时展示稳定空状态与上下文控制", () => {
    const html = renderToStaticMarkup(
      createElement(ImpactMappingWorkspace, { signedIn: true }),
    );

    expect(html).toContain("尚无成功快照");
    expect(html).toContain("最近更新的组合");
    expect(html).toContain("核心自选");
    expect(html).toContain("刷新雷达");
    expect(html).toContain("当前没有新闻事件");
  });
});
