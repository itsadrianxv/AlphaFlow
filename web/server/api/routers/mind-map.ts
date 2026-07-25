import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createMindMapInputSchema,
  mindMapSchema,
  mindMapSummarySchema,
  updateMindMapInputSchema,
} from "~/contracts/mind-map";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDto(row: {
  id: string;
  title: string;
  description: string | null;
  data: unknown;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  collections: Array<{ collectionId: string }>;
}) {
  return mindMapSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    data: asRecord(row.data),
    config: row.config === null ? null : asRecord(row.config),
    collectionIds: row.collections.map((item) => item.collectionId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function assertCollections(
  db: PrismaClient,
  userId: string,
  collectionIds: string[],
) {
  if (collectionIds.length === 0) return;
  const rows = await db.collection.findMany({
    where: { id: { in: collectionIds }, userId },
    select: { id: true },
  });
  if (rows.length !== new Set(collectionIds).size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "存在无权关联的投研收藏",
    });
  }
}

export const mindMapRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.mindMap.findMany({
      where: { userId: ctx.session.user.id },
      include: { collections: { select: { collectionId: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) =>
      mindMapSummarySchema.parse({
        id: row.id,
        title: row.title,
        description: row.description,
        collectionCount: row.collections.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.mindMap.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: { collections: { select: { collectionId: true } } },
      });
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "导图不存在" });
      return toDto(row);
    }),

  create: protectedProcedure
    .input(createMindMapInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCollections(ctx.db, ctx.session.user.id, input.collectionIds);
      const row = await ctx.db.mindMap.create({
        data: {
          userId: ctx.session.user.id,
          title: input.title,
          description: input.description ?? null,
          data: input.data as Prisma.InputJsonValue,
          config: input.config
            ? (input.config as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          collections: {
            create: input.collectionIds.map((collectionId) => ({
              collectionId,
            })),
          },
        },
        include: { collections: { select: { collectionId: true } } },
      });
      return toDto(row);
    }),

  update: protectedProcedure
    .input(updateMindMapInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.mindMap.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing)
        throw new TRPCError({ code: "NOT_FOUND", message: "导图不存在" });
      if (input.collectionIds) {
        await assertCollections(
          ctx.db,
          ctx.session.user.id,
          input.collectionIds,
        );
      }

      const row = await ctx.db.$transaction(async (tx) => {
        if (input.collectionIds) {
          await tx.collectionMindMap.deleteMany({
            where: { mindMapId: input.id },
          });
          if (input.collectionIds.length > 0) {
            await tx.collectionMindMap.createMany({
              data: input.collectionIds.map((collectionId) => ({
                collectionId,
                mindMapId: input.id,
              })),
            });
          }
        }
        return tx.mindMap.update({
          where: { id: input.id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.data !== undefined
              ? { data: input.data as Prisma.InputJsonValue }
              : {}),
            ...(input.config !== undefined
              ? {
                  config:
                    input.config === null
                      ? Prisma.JsonNull
                      : (input.config as Prisma.InputJsonValue),
                }
              : {}),
          },
          include: { collections: { select: { collectionId: true } } },
        });
      });
      return toDto(row);
    }),

  listCollections: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.collection.findMany({
      where: { userId: ctx.session.user.id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, collectionType: true },
    });
  }),

  setCollections: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        collectionIds: z.array(z.string()).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.mindMap.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!existing)
        throw new TRPCError({ code: "NOT_FOUND", message: "导图不存在" });
      await assertCollections(ctx.db, ctx.session.user.id, input.collectionIds);
      await ctx.db.$transaction(async (tx) => {
        await tx.collectionMindMap.deleteMany({
          where: { mindMapId: input.id },
        });
        if (input.collectionIds.length > 0) {
          await tx.collectionMindMap.createMany({
            data: input.collectionIds.map((collectionId) => ({
              collectionId,
              mindMapId: input.id,
            })),
          });
        }
      });
      return { id: input.id, collectionIds: input.collectionIds };
    }),
});
