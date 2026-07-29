import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "~/server/domain/scheduled-task/schedule";

describe("定时任务时间计算", () => {
  it("按 Asia/Shanghai 而不是 UTC 解释执行时间", async () => {
    const next = await computeNextRunAt(
      { type: "DAILY", time: "16:30", timezone: "Asia/Shanghai" },
      new Date("2026-07-26T07:00:00.000Z"),
    );
    expect(next?.toISOString()).toBe("2026-07-26T08:30:00.000Z");
  });

  it("按用户时区计算每周任务", async () => {
    const next = await computeNextRunAt(
      { type: "WEEKLY", time: "09:00", timezone: "Asia/Shanghai", weekdays: [1] },
      new Date("2026-07-26T10:00:00.000Z"),
    );
    expect(next?.toISOString()).toBe("2026-07-27T01:00:00.000Z");
  });

  it("交易日任务跳过休市日", async () => {
    const checked: string[] = [];
    const next = await computeNextRunAt(
      { type: "TRADING_DAY", time: "16:30", timezone: "Asia/Shanghai", marketCalendar: "SSE" },
      new Date("2026-07-25T10:00:00.000Z"),
      async (date) => {
        checked.push(date);
        return date === "2026-07-27";
      },
    );
    expect(checked).toEqual(["2026-07-26", "2026-07-27"]);
    expect(next?.toISOString()).toBe("2026-07-27T08:30:00.000Z");
  });
});
