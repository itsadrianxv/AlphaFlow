import { homePageSnapshotEnvelopeSchema } from "~/contracts/homepage";
import { homepageMarketBaselineSchema } from "~/contracts/homepage-market-baseline";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getHomePageSnapshot } from "~/server/application/homepage/home-page-snapshot-service";
import { readHomepageMarketBaseline } from "~/server/application/homepage/homepage-market-baseline-read-model";

export const homepageRouter = createTRPCRouter({
  getSnapshot: protectedProcedure.query(async ({ ctx }) =>
    homePageSnapshotEnvelopeSchema.parse(
      await getHomePageSnapshot(ctx.db, ctx.session.user.id),
    ),
  ),
  getMarketBaseline: protectedProcedure.query(async ({ ctx }) =>
    homepageMarketBaselineSchema.parse(await readHomepageMarketBaseline(ctx.db)),
  ),
});
