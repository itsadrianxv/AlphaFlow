import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedNewsLibraryService } from "~/server/application/intelligence/shared-news-library-service";

const rawItem = {
  sourceKind: "major" as const,
  sourceName: "测试媒体",
  title: "中科曙光扩大算力资本开支",
  content: "中科曙光扩大算力资本开支。",
  publishedAt: "2026-07-24T10:00:00+08:00",
  contentHash: "hash-1",
  sourceItemId: "source-1",
};

const targets = {
  days: 1,
  limit: 50,
  endAt: "2026-07-24T12:00:00+08:00",
  companies: [{ stockCode: "603019", companyName: "中科曙光" }],
  industries: [{ name: "算力" }],
};

function completedPrisma() {
  return {
    sharedNewsDaySync: {
      findUnique: vi.fn(async () => ({ status: "COMPLETED" })),
    },
    sharedNewsItem: {
      findMany: vi.fn(async () => [{ rawPayload: rawItem }]),
    },
  };
}

describe("SharedNewsLibraryService", () => {
  afterEach(() => vi.useRealTimers());

  it("当天已完成时直接复用数据库新闻，不再调用 Minishare", async () => {
    const prisma = completedPrisma();
    const getDailyNews = vi.fn();
    const resolveNewsRadar = vi.fn(async () => [{ id: "event-1", title: "算力扩产" }]);
    const service = new SharedNewsLibraryService(
      prisma as never,
      { getDailyNews, resolveNewsRadar } as never,
    );

    const result = await service.collectRadar(targets);

    expect(getDailyNews).not.toHaveBeenCalled();
    expect(resolveNewsRadar).toHaveBeenCalledWith(expect.objectContaining({ rawItems: [rawItem] }));
    expect(result.warnings).toEqual([]);
  });

  it("当天缓存 59 分钟内复用，达到 60 分钟后重新采集", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T04:00:00.000Z"));
    const completedAt = new Date("2026-07-24T03:01:00.000Z");
    const getDailyNews = vi.fn(async () => ({
      items: [rawItem],
      sourceStatus: { fast: true, major: true, cctv: true },
      complete: true,
    }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      sharedNewsDaySync: {
        findUnique: vi.fn(async () => ({
          status: "COMPLETED",
          completedAt,
          warnings: [],
        })),
        updateMany,
        update: vi.fn(async () => ({})),
      },
      sharedNewsItem: {
        upsert: vi.fn(async () => ({})),
        findMany: vi.fn(async () => [{ rawPayload: rawItem }]),
      },
      $transaction: vi.fn(async (operations) => Promise.all(operations)),
    };
    const service = new SharedNewsLibraryService(
      prisma as never,
      { getDailyNews, resolveNewsRadar: vi.fn(async () => []) } as never,
    );

    await service.collectRadar({ ...targets, endAt: "2026-07-24T12:00:00+08:00" });
    expect(getDailyNews).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-07-24T04:01:00.000Z"));
    await service.collectRadar({ ...targets, endAt: "2026-07-24T12:01:00+08:00" });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(getDailyNews).toHaveBeenCalledTimes(1);
  });

  it("缺失日期由一个领取者采集并写入共享库", async () => {
    const create = vi.fn(async () => ({}));
    const upsert = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const prisma = {
      sharedNewsDaySync: {
        findUnique: vi.fn(async () => null),
        create,
        updateMany: vi.fn(async () => ({ count: 0 })),
        update,
      },
      sharedNewsItem: {
        upsert,
        findMany: vi.fn(async () => [{ rawPayload: rawItem }]),
      },
      $transaction: vi.fn(async (operations) => Promise.all(operations)),
    };
    const getDailyNews = vi.fn(async () => ({
      items: [rawItem],
      sourceStatus: { fast: true, major: true, cctv: true },
      complete: true,
    }));
    const resolveNewsRadar = vi.fn(async () => []);
    const service = new SharedNewsLibraryService(
      prisma as never,
      { getDailyNews, resolveNewsRadar } as never,
    );

    await service.collectRadar(targets);

    expect(create).toHaveBeenCalledTimes(1);
    expect(getDailyNews).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceItemId: "source-1" } }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });
});
