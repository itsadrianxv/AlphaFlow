import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeedForUserMock = vi.fn();
const getSummaryForUserMock = vi.fn();

vi.mock("~/platform/trpc/server", () => {
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
  "~/modules/research/server/application/intelligence/opportunity-intelligence-service",
  () => ({
    OpportunityIntelligenceService: class OpportunityIntelligenceService {
      getFeedForUser = getFeedForUserMock;
      getSummaryForUser = getSummaryForUserMock;
    },
  }),
);

describe("researchOpportunitiesRouter", () => {
  beforeEach(() => {
    getFeedForUserMock.mockReset();
    getSummaryForUserMock.mockReset();
  });

  it("returns the full feed for the authenticated user", async () => {
    getFeedForUserMock.mockResolvedValue({
      asOf: "2026-04-19T08:30:00+08:00",
      status: "partial",
      todayTopLeads: [],
      trackingLeads: [],
      avoidanceItems: [],
      marketSummary: {
        todayConclusion: "先研究兑现更近的主线。",
        regimeSummary: "风险偏好修复。",
        flowSummary: "北向回流。",
      },
      personalization: {
        recentResearchMatchCount: 1,
        watchlistMatchCount: 1,
        portfolioMatchCount: 0,
      },
    });

    const { researchOpportunitiesRouter } = await import(
      "~/modules/research/server/api/opportunities-router"
    );
    const procedure = researchOpportunitiesRouter.getFeed as unknown as {
      handler(args: {
        ctx: { session: { user: { id: string } }; db: unknown };
      }): Promise<unknown>;
    };

    await expect(
      procedure.handler({
        ctx: {
          session: { user: { id: "user_1" } },
          db: {},
        },
      }),
    ).resolves.toMatchObject({
      status: "partial",
      marketSummary: {
        todayConclusion: "先研究兑现更近的主线。",
      },
    });
    expect(getFeedForUserMock).toHaveBeenCalledWith("user_1");
  });

  it("returns a compact summary with the requested limit", async () => {
    getSummaryForUserMock.mockResolvedValue({
      asOf: "2026-04-19T08:30:00+08:00",
      status: "partial",
      leads: [
        {
          slug: "ai-orders",
          title: "AI: 订单兑现靠近",
          href: "/opportunity-intelligence?lead=ai-orders",
        },
      ],
      personalizationHitCount: 1,
    });

    const { researchOpportunitiesRouter } = await import(
      "~/modules/research/server/api/opportunities-router"
    );
    const procedure = researchOpportunitiesRouter.getSummary as unknown as {
      handler(args: {
        ctx: { session: { user: { id: string } }; db: unknown };
        input: { limit: number };
      }): Promise<unknown>;
    };

    await expect(
      procedure.handler({
        ctx: {
          session: { user: { id: "user_1" } },
          db: {},
        },
        input: { limit: 2 },
      }),
    ).resolves.toMatchObject({
      leads: [
        {
          slug: "ai-orders",
        },
      ],
    });
    expect(getSummaryForUserMock).toHaveBeenCalledWith("user_1", 2);
  });
});
