import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSelection: vi.fn(),
  publishTask: vi.fn(),
}));

vi.mock("~/server/application/homepage/home-page-selection", () => ({
  resolveHomePageSelection: mocks.resolveSelection,
}));
vi.mock("~/server/application/homepage/home-page-task-stream", () => ({
  publishHomePageGenerationTask: mocks.publishTask,
}));

import { getHomePageSnapshot } from "~/server/application/homepage/home-page-snapshot-service";

const payload = {
  heatmap: {
    tradeDate: "20260801",
    marketCapAsOf: "20260801",
    priceSource: "daily",
    concepts: [],
  },
  overviewInsights: {},
  moneyFlow: {},
  impactMapping: null,
};

function snapshot(input: {
  id: string;
  scope: "DEFAULT" | "PERSONALIZED";
  baselineDefaultSnapshotId?: string | null;
}) {
  return {
    ...input,
    userId: input.scope === "PERSONALIZED" ? "user-1" : null,
    preferenceFingerprint: input.scope === "PERSONALIZED" ? "fp-1" : null,
    baselineDefaultSnapshotId: input.baselineDefaultSnapshotId ?? null,
    payload,
    dataAsOf: "20260801",
    generatedAt: new Date("2026-08-01T08:30:00.000Z"),
  };
}

describe("首页快照读取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishTask.mockResolvedValue({
      createdAt: "2026-08-01T09:00:00.000Z",
    });
  });

  it("无个性化偏好时只返回默认快照", async () => {
    mocks.resolveSelection.mockResolvedValue({
      personalized: false,
      fingerprint: "empty",
      selection: {},
    });
    const db = {
      homePageSnapshot: { findFirst: vi.fn(async () => snapshot({ id: "default-1", scope: "DEFAULT" })) },
      homePageGenerationTask: { findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "default-1",
      source: "DEFAULT",
      personalizationPending: false,
    });
    expect(db.homePageGenerationTask.upsert).not.toHaveBeenCalled();
  });

  it("当前指纹无快照时回退默认并入队", async () => {
    mocks.resolveSelection.mockResolvedValue({
      personalized: true,
      fingerprint: "fp-1",
      selection: { company: { id: "company-1" } },
    });
    const defaultSnapshot = snapshot({ id: "default-1", scope: "DEFAULT" });
    const task = { id: "task-1", status: "PENDING", eventPublishedAt: null };
    const db = {
      homePageSnapshot: {
        findFirst: vi.fn().mockResolvedValueOnce(defaultSnapshot).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "default-1" }),
      },
      homePageGenerationTask: {
        upsert: vi.fn(async () => task),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirst: vi.fn(),
      },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      source: "DEFAULT",
      personalizationPending: true,
      isRefreshing: true,
    });
    expect(db.homePageGenerationTask.upsert).toHaveBeenCalledTimes(1);
  });

  it("跨日优先旧个性化快照并按新默认基线刷新", async () => {
    mocks.resolveSelection.mockResolvedValue({
      personalized: true,
      fingerprint: "fp-1",
      selection: { industry: { id: "industry-1" } },
    });
    const personalized = snapshot({
      id: "personalized-1",
      scope: "PERSONALIZED",
      baselineDefaultSnapshotId: "default-old",
    });
    const task = { id: "task-2", status: "PENDING", eventPublishedAt: new Date() };
    const db = {
      homePageSnapshot: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(snapshot({ id: "default-new", scope: "DEFAULT" }))
          .mockResolvedValueOnce(personalized)
          .mockResolvedValueOnce({ id: "default-new" }),
      },
      homePageGenerationTask: {
        upsert: vi.fn(async () => task),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst: vi.fn(),
      },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "personalized-1",
      source: "PERSONALIZED",
      isStale: true,
      isRefreshing: true,
      personalizationPending: false,
    });
  });
});
