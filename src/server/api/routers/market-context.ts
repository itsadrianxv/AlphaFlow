import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PythonMarketContextClient } from "~/server/infrastructure/intelligence/python-market-context-client";

export const marketContextRouter = createTRPCRouter({
  getSnapshot: protectedProcedure.query(async () => {
    const client = new PythonMarketContextClient();
    return client.getSnapshot();
  }),
});
