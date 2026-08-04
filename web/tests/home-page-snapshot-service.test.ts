import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHomePageSnapshot } from "~/server/application/homepage/home-page-snapshot-service";
import { readHomepageMarketBaseline } from "~/server/application/homepage/homepage-market-baseline-read-model";

vi.mock(
  "~/server/application/homepage/homepage-market-baseline-read-model",
  () => ({
    readHomepageMarketBaseline: vi.fn(async () => {
      throw new Error("普通首页读取不应调用完整专业市场基线读模型");
    }),
  }),
);

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

function projection(input: {
  id: string;
  scope: "BASELINE" | "PERSONALIZED";
  manifestId: string;
  userId?: string | null;
  baseManifestId?: string | null;
  activationSequence?: bigint;
}) {
  return {
    id: `${input.id}:projection`,
    scope: input.scope,
    userId: input.userId ?? null,
    activationSequence: input.activationSequence ?? 1n,
    snapshot: {
      id: input.id,
      scope: input.scope,
      userId: input.userId ?? null,
      manifestId: input.manifestId,
      payloadJson: payload,
      dataCoverageJson: [{ datasetKey: "market_heatmap" }],
      generatedAt: new Date("2026-08-01T08:30:00.000Z"),
      manifest: { baseManifestId: input.baseManifestId ?? null },
    },
  };
}

describe("首页快照读取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无个性化投影时读取专业市场基线当前投影", async () => {
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(projection({ id: "baseline-1", scope: "BASELINE", manifestId: "manifest-base" })),
      },
      homepageGenerationTask: { findFirst: vi.fn(async () => null) },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "baseline-1",
      source: "BASELINE",
      manifestId: "manifest-base",
      baselineOutdated: false,
      refreshInProgress: false,
      personalizationPending: false,
    });
    expect(readHomepageMarketBaseline).not.toHaveBeenCalled();
  });

  it("普通首页读取不会查询历史 100 份完整基线快照", async () => {
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            projection({
              id: "baseline-1",
              scope: "BASELINE",
              manifestId: "manifest-base",
            }),
          ),
      },
      homepageGenerationTask: { findFirst: vi.fn(async () => null) },
      homepageSnapshot: {
        findMany: vi.fn(async () => {
          throw new Error("普通首页读取不应查询完整基线历史快照");
        }),
      },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result.payload.heatmap).toEqual(payload.heatmap);
    expect(result).not.toHaveProperty("marketBaseline");
    expect(db.homepageSnapshot.findMany).not.toHaveBeenCalled();
  });

  it("只有专业市场基线任务时不误报个性化处理中", async () => {
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            projection({
              id: "baseline-1",
              scope: "BASELINE",
              manifestId: "manifest-base",
            }),
          ),
      },
      homepageGenerationTask: {
        findFirst: vi.fn(async (args: { where: { manifest: { scope: string } } }) =>
          args.where.manifest.scope === "BASELINE"
            ? { id: "baseline-task-1" }
            : null,
        ),
      },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      source: "BASELINE",
      refreshInProgress: true,
      personalizationPending: false,
    });
  });

  it("个性化未就绪但存在任务时回退基线并标记 pending", async () => {
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(projection({ id: "baseline-1", scope: "BASELINE", manifestId: "manifest-base" })),
      },
      homepageGenerationTask: { findFirst: vi.fn(async () => ({ id: "task-1" })) },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      source: "BASELINE",
      refreshInProgress: true,
      personalizationPending: true,
    });
  });

  it("旧个性化基线仍可服务但标记父基线过期", async () => {
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(
            projection({
              id: "personalized-1",
              scope: "PERSONALIZED",
              userId: "user-1",
              manifestId: "manifest-personal",
              baseManifestId: "manifest-old-base",
            }),
          )
          .mockResolvedValueOnce(projection({ id: "baseline-2", scope: "BASELINE", manifestId: "manifest-new-base" })),
      },
      homepageGenerationTask: { findFirst: vi.fn(async () => ({ id: "task-2" })) },
    };

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "personalized-1",
      source: "PERSONALIZED",
      baselineOutdated: true,
      refreshInProgress: true,
      personalizationPending: false,
    });
  });
});
