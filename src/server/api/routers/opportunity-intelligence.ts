import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { OpportunityIntelligenceService } from "~/server/application/intelligence/opportunity-intelligence-service";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PythonMarketContextClient } from "~/server/infrastructure/intelligence/python-market-context-client";

export const opportunityIntelligenceRouter = createTRPCRouter({
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
