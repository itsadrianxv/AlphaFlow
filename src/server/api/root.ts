import { createCallerFactory, createTRPCRouter } from "~/platform/trpc/server";
import { marketRouter } from "~/server/api/routers/market";
import { researchRouter } from "~/server/api/routers/research";
import { screeningRouter } from "~/server/api/routers/screening";
import { timingRouter } from "~/server/api/routers/timing";
import { watchlistRouter } from "~/server/api/routers/watchlist";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  market: marketRouter,
  research: researchRouter,
  screening: screeningRouter,
  timing: timingRouter,
  watchlist: watchlistRouter,
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
