import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const scheduleSpec = z.object({
  type: z.enum(["DAILY", "WEEKLY", "TRADING_DAY"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).default("Asia/Shanghai"),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  marketCalendar: z.string().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

const draft = z.object({
  name: z.string().min(1).max(200),
  userPrompt: z.string().min(1),
  schedule: scheduleSpec,
  dataSources: z.array(z.record(z.string(), z.unknown())).default([]),
  executionPlan: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  delivery: z.record(z.string(), z.unknown()).default({}),
  nextRunAt: z.string().datetime().optional(),
});

export const scheduledTaskRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.scheduledTask.findMany({
      where: { userId: ctx.session.user.id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
  ),
  confirm: protectedProcedure.input(draft).mutation(async ({ ctx, input }) => {
    const nextRunAt = input.nextRunAt ? new Date(input.nextRunAt) : null;
    return ctx.db.scheduledTask.create({
      data: {
        userId: ctx.session.user.id,
        name: input.name,
        status: "ACTIVE",
        timezone: input.schedule.timezone,
        nextRunAt,
        currentVersion: 1,
        versions: {
          create: {
            version: 1,
            userPrompt: input.userPrompt,
            scheduleSpec: input.schedule as unknown as Prisma.InputJsonObject,
            executionPlan: input.executionPlan as Prisma.InputJsonObject,
            outputSpec: input.output as Prisma.InputJsonObject,
            deliverySpec: input.delivery as Prisma.InputJsonObject,
          },
        },
      },
      include: { versions: true },
    });
  }),
  pause: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.scheduledTask.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, status: "ACTIVE" },
        data: { status: "PAUSED" },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
  resume: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.scheduledTask.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, status: "PAUSED" },
        data: { status: "ACTIVE" },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.scheduledTask.updateMany({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
          status: { in: ["ACTIVE", "PAUSED", "DRAFT"] },
        },
        data: { status: "CANCELLED", nextRunAt: null },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
