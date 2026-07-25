import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  getMoneyFlowSnapshot,
  getOverviewInsights,
  getSellSideForecastDetail,
  listSellSideRevisions,
} from "~/server/application/overview/sell-side-overview-service";

export const overviewInsightsRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx }) =>
    getOverviewInsights(ctx.session.user.id),
  ),
  getMoneyFlow: protectedProcedure.query(() => getMoneyFlowSnapshot()),
  listSellSideRevisions: protectedProcedure
    .input(
      z.object({
        cursor: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ input }) => listSellSideRevisions(input.cursor, input.limit)),
  getSellSideForecastDetail: protectedProcedure
    .input(z.object({ stockCode: z.string().regex(/^\d{6}$/) }))
    .query(({ input }) => getSellSideForecastDetail(input.stockCode)),
});
