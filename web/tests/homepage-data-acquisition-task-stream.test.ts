import { describe, expect, it, vi } from "vitest";
import { publishHomepageDataAcquisitionAttempt } from "~/server/application/homepage/homepage-data-acquisition-task-stream";

describe("首页数据获取任务 Redis 消息契约", () => {
  it("发布 C++ worker 约定的 executionId/enqueuedAt 字段", async () => {
    const xadd = vi.fn().mockResolvedValue("1-0");

    const published = await publishHomepageDataAcquisitionAttempt(
      "attempt-1",
      { xadd },
    );

    const args = xadd.mock.calls[0] as unknown[];
    expect(args).toHaveLength(8);
    expect(args.slice(0, 6)).toEqual([
      "homepage:data-acquisition",
      "*",
      "schemaVersion",
      "1",
      "executionId",
      "attempt-1",
    ]);
    expect(args[6]).toBe("enqueuedAt");
    expect(args[7]).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(args[7] as string))).toBe(false);
    expect(published.createdAt).toBe(args[7]);
    expect(args).not.toContain("runId");
    expect(args).not.toContain("createdAt");
    expect(args).not.toContain("eventId");
  });
});
