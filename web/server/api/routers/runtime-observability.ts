import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  runtimeMetricFilterSchema,
  runtimeReleaseCheckSchema,
} from "~/contracts/runtime-observability";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { RuntimeObservabilityService } from "~/server/application/runtime-observability/runtime-observability-service";
import { PrismaRuntimeObservabilityRepository } from "~/server/infrastructure/runtime-observability/prisma-runtime-observability-repository";

function service(db: PrismaClient) {
  return new RuntimeObservabilityService(
    new PrismaRuntimeObservabilityRepository(db),
  );
}

function toMetricFilter(
  input: z.infer<typeof runtimeMetricFilterSchema> | undefined,
) {
  return input
    ? {
        ...input,
        from: input.from ? new Date(input.from) : undefined,
        to: input.to ? new Date(input.to) : undefined,
      }
    : {};
}

export const runtimeObservabilityRouter = createTRPCRouter({
  metrics: protectedProcedure
    .input(runtimeMetricFilterSchema)
    .query(async ({ ctx, input }) => {
      return service(ctx.db).query({
        ...toMetricFilter(input),
      });
    }),

  alerts: protectedProcedure
    .input(runtimeMetricFilterSchema.optional())
    .query(async ({ ctx, input }) =>
      service(ctx.db).listAlerts(toMetricFilter(input)),
    ),

  breaches: protectedProcedure
    .input(runtimeMetricFilterSchema.optional())
    .query(async ({ ctx, input }) =>
      service(ctx.db).listBreaches(toMetricFilter(input)),
    ),

  evaluateRelease: protectedProcedure
    .input(
      z.object({
        checks: z.array(runtimeReleaseCheckSchema),
        runtimeBreaches: z.array(z.string().trim().min(1)),
      }),
    )
    .query(async ({ ctx, input }) => service(ctx.db).evaluateRelease(input)),

  recordRelease: protectedProcedure
    .input(
      z.object({
        evaluationKey: z.string().trim().min(1).max(200),
        checks: z.array(runtimeReleaseCheckSchema),
        runtimeBreaches: z.array(z.string().trim().min(1)),
        checkedAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      service(ctx.db).recordReleaseEvaluation({
        ...input,
        checkedAt: input.checkedAt ? new Date(input.checkedAt) : undefined,
      }),
    ),

  releaseHistory: protectedProcedure.query(async ({ ctx }) =>
    service(ctx.db).listReleaseEvaluations(),
  ),
});
