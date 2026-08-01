import { agentRuntimeRouter } from "~/server/api/routers/agent-runtime";
import { companyOverviewRouter } from "~/server/api/routers/company-overview";
import { evidenceContextRouter } from "~/server/api/routers/evidence-context";
import { heatmapRouter } from "~/server/api/routers/heatmap";
import { homepageRouter } from "~/server/api/routers/homepage";
import { intelligenceRouter } from "~/server/api/routers/intelligence";
import { marketContextRouter } from "~/server/api/routers/market-context";
import { collectionRouter } from "~/server/api/routers/collection";
import { mindMapRouter } from "~/server/api/routers/mind-map";
import { overviewInsightsRouter } from "~/server/api/routers/overview-insights";
import { postRouter } from "~/server/api/routers/post";
import { researchTargetRouter } from "~/server/api/routers/research-target";
import { scheduledTaskRouter } from "~/server/api/routers/scheduled-task";
import { screeningRouter } from "~/server/api/routers/screening";
import { timingRouter } from "~/server/api/routers/timing";
import { watchlistRouter } from "~/server/api/routers/watchlist";
import { workflowRouter } from "~/server/api/routers/workflow";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  collection: collectionRouter,
  agentRuntime: agentRuntimeRouter,
  companyOverview: companyOverviewRouter,
  evidenceContext: evidenceContextRouter,
  heatmap: heatmapRouter,
  homepage: homepageRouter,
  intelligence: intelligenceRouter,
  marketContext: marketContextRouter,
  mindMap: mindMapRouter,
  overviewInsights: overviewInsightsRouter,
  post: postRouter,
  researchTarget: researchTargetRouter,
  screening: screeningRouter,
  scheduledTask: scheduledTaskRouter,
  timing: timingRouter,
  watchlist: watchlistRouter,
  workflow: workflowRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
