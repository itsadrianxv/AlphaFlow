import { intelligenceRouter } from "~/server/api/routers/intelligence";
import { marketContextRouter } from "~/server/api/routers/market-context";
import { opportunityIntelligenceRouter } from "~/server/api/routers/opportunity-intelligence";
import { postRouter } from "~/server/api/routers/post";
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
  intelligence: intelligenceRouter,
  marketContext: marketContextRouter,
  opportunityIntelligence: opportunityIntelligenceRouter,
  post: postRouter,
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
