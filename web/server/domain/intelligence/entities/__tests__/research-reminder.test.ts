import { describe, expect, it } from "vitest";
import { ResearchReminder } from "~/server/domain/intelligence/entities/research-reminder";

describe("ResearchReminder", () => {
  it("accepts a timing review target", () => {
    const reminder = ResearchReminder.create({
      userId: "user-1",
      timingReviewRecordId: "review-1",
      stockCode: "600519",
      reminderType: "REVIEW",
      targetType: "TIMING_REVIEW",
      scheduledAt: new Date("2026-03-20T00:00:00.000Z"),
      payload: {},
    });

    expect(reminder.timingReviewRecordId).toBe("review-1");
  });

  it("rejects reminders without a timing review target", () => {
    expect(() =>
      ResearchReminder.create({
        userId: "user-1",
        stockCode: "600519",
        reminderType: "REVIEW",
        targetType: "TIMING_REVIEW",
        scheduledAt: new Date("2026-03-20T00:00:00.000Z"),
        payload: {},
      }),
    ).toThrow("择时复查提醒缺少 timingReviewRecordId");
  });
});
