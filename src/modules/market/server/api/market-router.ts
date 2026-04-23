import { PythonMarketContextClient } from "~/modules/research/server/infrastructure/intelligence/python-market-context-client";
import { createTRPCRouter, protectedProcedure } from "~/platform/trpc/server";

export const marketRouter = createTRPCRouter({
  getSnapshot: protectedProcedure.query(async () => {
    const client = new PythonMarketContextClient();
    return client.getSnapshot();
  }),
});
