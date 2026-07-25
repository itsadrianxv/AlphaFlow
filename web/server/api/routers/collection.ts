import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import {
  collectionSchema,
  collectionSummarySchema,
  createCollectionInputSchema,
  updateCollectionInputSchema,
} from "~/contracts/collection";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDto(record: {
  id: string;
  collectionType: "COMPANY" | "INDUSTRY" | "WATCHLIST";
  title: string;
  description: string | null;
  tags: string[];
  payload: unknown;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return collectionSchema.parse({
    id: record.id,
    collectionType: record.collectionType,
    title: record.title,
    description: record.description,
    tags: record.tags,
    payload: asRecord(record.payload),
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export const collectionRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.collection.findMany({
      where: { userId: ctx.session.user.id },
      include: { _count: { select: { mindMaps: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return rows.map((row) =>
      collectionSummarySchema.parse({
        ...toDto(row),
        mindMapCount: row._count.mindMaps,
      }),
    );
  }),

  create: protectedProcedure
    .input(createCollectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.collection.create({
        data: {
          userId: ctx.session.user.id,
          collectionType: input.collectionType,
          title: input.title,
          description: input.description ?? null,
          tags: input.tags,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
      return toDto(row);
    }),

  update: protectedProcedure
    .input(updateCollectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.collection.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "收藏不存在" });
      }

      const row = await ctx.db.collection.update({
        where: { id: input.id },
        data: {
          ...(input.collectionType
            ? { collectionType: input.collectionType }
            : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.tags ? { tags: input.tags } : {}),
          ...(input.payload
            ? { payload: input.payload as Prisma.InputJsonValue }
            : {}),
          ...(input.archivedAt !== undefined
            ? {
                archivedAt: input.archivedAt
                  ? new Date(input.archivedAt)
                  : null,
              }
            : {}),
        },
      });
      return toDto(row);
    }),
});
