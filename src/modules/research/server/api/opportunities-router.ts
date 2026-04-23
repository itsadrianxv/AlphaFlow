import { z } from "zod";
import { OpportunityIntelligenceService } from "~/modules/research/server/application/intelligence/opportunity-intelligence-service";
import { PythonIntelligenceDataClient } from "~/modules/research/server/infrastructure/intelligence/python-intelligence-data-client";
import { PythonMarketContextClient } from "~/modules/research/server/infrastructure/intelligence/python-market-context-client";
import { createTRPCRouter, protectedProcedure } from "~/platform/trpc/server";

export const researchOpportunitiesRouter = createTRPCRouter({
  getFeed: protectedProcedure.query(async ({ ctx }) => {
    const service = new OpportunityIntelligenceService({
      db: ctx.db,
      marketContextClient: new PythonMarketContextClient(),
      intelligenceClient: new PythonIntelligenceDataClient(),
    });

    return service.getFeedForUser(ctx.session.user.id);
  }),

  getSummary: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(3).default(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = new OpportunityIntelligenceService({
        db: ctx.db,
        marketContextClient: new PythonMarketContextClient(),
        intelligenceClient: new PythonIntelligenceDataClient(),
      });

      return service.getSummaryForUser(ctx.session.user.id, input.limit);
    }),
});
