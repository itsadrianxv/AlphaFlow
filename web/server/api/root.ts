import { agentRuntimeRouter } from "~/server/api/routers/agent-runtime";
import { heatmapRouter } from "~/server/api/routers/heatmap";
import { intelligenceRouter } from "~/server/api/routers/intelligence";
import { marketContextRouter } from "~/server/api/routers/market-context";
import { postRouter } from "~/server/api/routers/post";
import { researchTargetRouter } from "~/server/api/routers/research-target";
import { screeningRouter } from "~/server/api/routers/screening";
import { spaceRouter } from "~/server/api/routers/space";
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
  agentRuntime: agentRuntimeRouter,
  heatmap: heatmapRouter,
  intelligence: intelligenceRouter,
  marketContext: marketContextRouter,
  post: postRouter,
  researchTarget: researchTargetRouter,
  screening: screeningRouter,
  space: spaceRouter,
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
