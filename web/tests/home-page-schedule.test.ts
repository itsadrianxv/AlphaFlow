import { describe, expect, it } from "vitest";
import {
  homePageDueDateCandidates,
  homePageRevalidationBucket,
  shanghaiClock,
} from "~/server/application/homepage/home-page-schedule";

describe("首页默认快照调度", () => {
  it("上海时间 16:30 后包含当天", () => {
    const now = new Date("2026-08-03T08:30:00.000Z");
    expect(shanghaiClock(now)).toMatchObject({
      date: "2026-08-03",
      hour: 16,
      minute: 30,
    });
    expect(homePageDueDateCandidates(now, 3)).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });

  it("上海时间 16:30 前从上一日开始补发", () => {
    const now = new Date("2026-08-03T01:00:00.000Z");
    expect(homePageDueDateCandidates(now, 3)).toEqual([
      "2026-08-02",
      "2026-08-01",
      "2026-07-31",
    ]);
  });

  it("同一上海自然小时复用重验证桶", () => {
    expect(homePageRevalidationBucket(new Date("2026-08-03T01:01:00.000Z"))).toBe(
      "2026-08-03T09",
    );
    expect(homePageRevalidationBucket(new Date("2026-08-03T01:59:59.000Z"))).toBe(
      "2026-08-03T09",
    );
    expect(homePageRevalidationBucket(new Date("2026-08-03T02:00:00.000Z"))).toBe(
      "2026-08-03T10",
    );
  });
});
