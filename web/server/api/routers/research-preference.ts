import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  researchPreferenceChannelsSchema,
  researchPreferenceExplanationSchema,
  researchPreferenceImportCandidateSchema,
  researchPreferenceItemSchema,
  researchPreferenceMatchInputSchema,
  researchPreferenceStateSchema,
  researchPreferenceTargetSchema,
} from "~/contracts/research-preference";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  ResearchPreferenceService,
  ResearchPreferenceSnapshotNotFoundError,
  ResearchPreferenceValidationError,
} from "~/server/application/research-preference/research-preference-service";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";

const commandIdSchema = z.string().trim().min(1).max(200);
const targetInput = researchPreferenceTargetSchema;

function service(db: PrismaClient) {
  return new ResearchPreferenceService(
    new PrismaResearchPreferenceRepository(db),
  );
}

function mapError(error: unknown): never {
  if (error instanceof ResearchPreferenceValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof ResearchPreferenceSnapshotNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

export const researchPreferenceRouter = createTRPCRouter({
  importCandidates: protectedProcedure.query(async ({ ctx }) => {
    return (
      await service(ctx.db).listImportCandidates(ctx.session.user.id)
    ).map((candidate) =>
      researchPreferenceImportCandidateSchema.parse(candidate),
    );
  }),

  current: protectedProcedure.query(async ({ ctx }) => {
    return researchPreferenceStateSchema.parse(
      await service(ctx.db).getCurrent(ctx.session.user.id),
    );
  }),

  add: protectedProcedure
    .input(
      z.object({
        commandId: commandIdSchema,
        target: targetInput,
        level: researchPreferenceItemSchema.shape.level.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).add(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  import: protectedProcedure
    .input(
      z.object({
        commandId: commandIdSchema,
        targets: z.array(targetInput).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).import(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  setLevel: protectedProcedure
    .input(
      z.object({
        commandId: commandIdSchema,
        target: targetInput,
        level: researchPreferenceItemSchema.shape.level,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).setLevel(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  remove: protectedProcedure
    .input(z.object({ commandId: commandIdSchema, target: targetInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).remove(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  restore: protectedProcedure
    .input(z.object({ commandId: commandIdSchema, target: targetInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).restore(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  setEnabled: protectedProcedure
    .input(z.object({ commandId: commandIdSchema, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).setEnabled(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  setChannels: protectedProcedure
    .input(
      z.object({
        commandId: commandIdSchema,
        channels: researchPreferenceChannelsSchema
          .partial()
          .refine(
            (value) => Object.keys(value).length > 0,
            "至少需要一个分发开关",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).setChannels(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  clear: protectedProcedure
    .input(z.object({ commandId: commandIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return researchPreferenceStateSchema.parse(
          await service(ctx.db).clear(ctx.session.user.id, input.commandId),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  freeze: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await service(ctx.db).freeze(ctx.session.user.id);
    } catch (error) {
      return mapError(error);
    }
  }),

  explain: protectedProcedure
    .input(
      z.object({
        snapshotId: z.string().trim().min(1),
        candidates: z.array(researchPreferenceMatchInputSchema).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return researchPreferenceExplanationSchema.parse(
          await service(ctx.db).explain({
            userId: ctx.session.user.id,
            ...input,
          }),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  deletePersonalData: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await service(ctx.db).deletePersonalData(ctx.session.user.id);
      return { deleted: true } as const;
    } catch (error) {
      return mapError(error);
    }
  }),
});
