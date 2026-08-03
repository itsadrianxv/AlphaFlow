import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  researchInboxEntrySchema,
  researchInboxFeedbackSchema,
  researchInboxFilterSchema,
  researchInboxStateSchema,
} from "~/contracts/research-inbox";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  ResearchInboxEntryNotFoundError,
  ResearchInboxService,
  ResearchInboxValidationError,
} from "~/server/application/research-inbox/research-inbox-service";
import { PrismaResearchInboxRepository } from "~/server/infrastructure/research-inbox/prisma-research-inbox-repository";

const commandIdSchema = z.string().trim().min(1).max(200);

function service(db: PrismaClient) {
  return new ResearchInboxService(new PrismaResearchInboxRepository(db));
}

function mapError(error: unknown): never {
  if (error instanceof ResearchInboxEntryNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ResearchInboxValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

export const researchInboxRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ filter: researchInboxFilterSchema }))
    .query(async ({ ctx, input }) => {
      const result = await service(ctx.db).list(
        ctx.session.user.id,
        input.filter,
      );
      return {
        ...result,
        items: result.items.map((entry) =>
          researchInboxEntrySchema.parse(entry),
        ),
      };
    }),

  get: protectedProcedure
    .input(z.object({ entryId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return researchInboxEntrySchema.parse(
          await service(ctx.db).get(ctx.session.user.id, input.entryId),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  open: protectedProcedure
    .input(z.object({ entryId: z.string().min(1), commandId: commandIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return researchInboxEntrySchema.parse(
          await service(ctx.db).open(
            ctx.session.user.id,
            input.entryId,
            input.commandId,
          ),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  changeState: protectedProcedure
    .input(
      z.object({
        entryId: z.string().min(1),
        state: researchInboxStateSchema,
        commandId: commandIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchInboxEntrySchema.parse(
          await service(ctx.db).changeState(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),

  setFeedback: protectedProcedure
    .input(
      z.object({
        entryId: z.string().min(1),
        value: researchInboxFeedbackSchema,
        commandId: commandIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return researchInboxEntrySchema.parse(
          await service(ctx.db).setFeedback(ctx.session.user.id, input),
        );
      } catch (error) {
        return mapError(error);
      }
    }),
});
