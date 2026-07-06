import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";

const paginationSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export const intelligenceRouter = createTRPCRouter({
  listPendingReminders: protectedProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaResearchReminderRepository(ctx.db);
      const reminders = await repository.findPendingByUserId(
        ctx.session.user.id,
        input.limit,
        input.offset,
      );

      return reminders.map((item) => ({
        id: item.id,
        timingReviewRecordId: item.timingReviewRecordId,
        stockCode: item.stockCode,
        reminderType: item.reminderType,
        scheduledAt: item.scheduledAt,
        status: item.status,
        payload: item.payload,
        triggeredAt: item.triggeredAt,
      }));
    }),

  acknowledgeReminder: protectedProcedure
    .input(z.object({ reminderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaResearchReminderRepository(ctx.db);
      const reminder = await repository.findById(input.reminderId);

      if (!reminder || reminder.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "提醒不存在",
        });
      }

      reminder.markTriggered();
      await repository.save(reminder);

      return {
        id: reminder.id,
        status: reminder.status,
        triggeredAt: reminder.triggeredAt,
      };
    }),
});
