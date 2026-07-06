import { beforeEach, describe, expect, it, vi } from "vitest";

const getSnapshotMock = vi.fn();

vi.mock("~/server/api/trpc", () => {
  const procedureBuilder = {
    use: () => procedureBuilder,
    input(schema: unknown) {
      return {
        query: (handler: unknown) => ({ schema, handler }),
        mutation: (handler: unknown) => ({ schema, handler }),
      };
    },
    query: (handler: unknown) => ({ handler }),
    mutation: (handler: unknown) => ({ handler }),
  };

  return {
    createTRPCRouter: (router: Record<string, unknown>) => router,
    protectedProcedure: procedureBuilder,
  };
});

vi.mock(
  "~/server/infrastructure/intelligence/python-market-context-client",
  () => ({
    PythonMarketContextClient: class PythonMarketContextClient {
      getSnapshot = getSnapshotMock;
    },
  }),
);

describe("marketContextRouter.getSnapshot", () => {
  beforeEach(() => {
    getSnapshotMock.mockReset();
  });

  it("returns the market context snapshot from the python client", async () => {
    getSnapshotMock.mockResolvedValue({
      asOf: "2026-04-18T00:00:00+00:00",
      status: "complete",
      regime: {
        overallTone: "risk_on",
        growthTone: "expansion",
        liquidityTone: "supportive",
        riskTone: "risk_on",
        summary: "景气修复",
        drivers: ["PMI > 50"],
      },
      flow: {
        northboundNetAmount: 1762.62,
        direction: "inflow",
        summary: "北向净流入",
      },
      hotThemes: [],
      downstreamHints: {
        workflows: {
          summary: "优先研究高景气主题。",
          suggestedQuestion: "围绕 AI 产业链，当前景气扩散到哪些环节？",
        },
        companyResearch: {
          summary: "优先确认主题兑现路径。",
        },
        screening: {
          summary: "优先从热门主题候选股开始缩小范围。",
          suggestedDraftName: "AI 热门主题候选池",
        },
        timing: {
          summary: "风险偏好偏强。",
        },
      },
      availability: {
        regime: { available: true },
        flow: { available: true },
        hotThemes: { available: true },
      },
    });

    const { marketContextRouter } = await import(
      "~/server/api/routers/market-context"
    );
    const procedure = marketContextRouter.getSnapshot as unknown as {
      handler(args: {
        ctx: { session: { user: { id: string } } };
      }): Promise<unknown>;
    };

    await expect(
      procedure.handler({
        ctx: {
          session: { user: { id: "user_1" } },
        },
      }),
    ).resolves.toMatchObject({
      status: "complete",
    });
    expect(getSnapshotMock).toHaveBeenCalledTimes(1);
  });
});
