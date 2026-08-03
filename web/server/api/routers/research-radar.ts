import { z } from "zod";
import { researchRadarResultSchema } from "~/contracts/research-radar";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ResearchRadarService } from "~/server/application/research-radar/research-radar-service";
import { PrismaResearchRadarRepository } from "~/server/infrastructure/research-radar/prisma-research-radar-repository";

export const researchRadarRouter = createTRPCRouter({
  query: protectedProcedure
    .input(z.object({ capacity: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const service = new ResearchRadarService(
        new PrismaResearchRadarRepository(ctx.db),
      );
      return researchRadarResultSchema.parse(
        await service.query(ctx.session.user.id, input.capacity),
      );
    }),
});
