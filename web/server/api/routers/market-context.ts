import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PythonMarketContextClient } from "~/server/infrastructure/intelligence/python-market-context-client";

export const marketContextRouter = createTRPCRouter({
  getSnapshot: protectedProcedure
    .input(
      z
        .object({
          forceRefresh: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const client = new PythonMarketContextClient();
      return client.getSnapshot({
        forceRefresh: input?.forceRefresh ?? false,
      });
    }),
});
