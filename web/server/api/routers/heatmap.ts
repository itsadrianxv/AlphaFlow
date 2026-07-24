import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PythonMarketHeatmapClient } from "~/server/infrastructure/market/python-market-heatmap-client";

export const heatmapRouter = createTRPCRouter({
  getSnapshot: protectedProcedure.query(async () =>
    new PythonMarketHeatmapClient().getSnapshot(),
  ),
});
