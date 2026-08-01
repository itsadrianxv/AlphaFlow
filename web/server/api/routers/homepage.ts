import { homePageSnapshotEnvelopeSchema } from "~/contracts/homepage";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getHomePageSnapshot } from "~/server/application/homepage/home-page-snapshot-service";

export const homepageRouter = createTRPCRouter({
  getSnapshot: protectedProcedure.query(async ({ ctx }) =>
    homePageSnapshotEnvelopeSchema.parse(
      await getHomePageSnapshot(ctx.db, ctx.session.user.id),
    ),
  ),
});
