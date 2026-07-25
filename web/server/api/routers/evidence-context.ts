import { z } from "zod";
import { evidenceContextDetailSchema } from "~/contracts/evidence-context";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";

const itemIdInput = z.object({ itemId: z.string().min(1) });
const itemIdsInput = z.object({ itemIds: z.array(z.string().min(1)).max(100) });
const runInput = z.object({ runId: z.string().min(1) });
const snapshotInput = z.object({ snapshotId: z.string().min(1) });
const claimInput = z.object({ claimId: z.string().min(1) });

export const evidenceContextRouter = createTRPCRouter({
  getItem: protectedProcedure
    .input(itemIdInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      const detail = await repository.getItemForUser(
        ctx.session.user.id,
        input.itemId,
      );
      if (!detail) return null;
      return evidenceContextDetailSchema.parse(detail);
    }),

  listItems: protectedProcedure
    .input(itemIdsInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      const details = await repository.listItemsForUser(
        ctx.session.user.id,
        input.itemIds,
      );
      return details.map((detail) => evidenceContextDetailSchema.parse(detail));
    }),

  listForRun: protectedProcedure
    .input(runInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      const contexts = await repository.listContextsForRun(
        ctx.session.user.id,
        input.runId,
      );
      return contexts.map((context) => ({
        id: context.id,
        workflowRunId: context.workflowRunId,
        subject: context.subject,
        phase: context.phase,
        blockCount: context.blocks.length,
        itemCount: context.blocks.reduce(
          (sum, block) => sum + block.items.length,
          0,
        ),
        createdAt: context.createdAt,
        quality: context.blocks.map((block) => ({
          blockKey: block.blockKey,
          status: block.status,
          warnings: block.warnings,
          limitations: block.limitations,
        })),
      }));
    }),

  lineage: protectedProcedure
    .input(itemIdInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      const items = await repository.getLineageForUser(ctx.session.user.id, input.itemId);
      return items.map((item) => evidenceContextDetailSchema.parse(item));
    }),

  getSnapshot: protectedProcedure
    .input(snapshotInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      return repository.getSnapshotForUser(ctx.session.user.id, input.snapshotId);
    }),

  getClaim: protectedProcedure
    .input(claimInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaEvidenceContextRepository(ctx.db);
      return repository.getClaimForUser(ctx.session.user.id, input.claimId);
    }),
});
