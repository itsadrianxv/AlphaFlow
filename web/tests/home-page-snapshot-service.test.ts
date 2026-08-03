import { describe, expect, it, vi } from "vitest";

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

function database(input: {
  personalizedProjection?: ReturnType<typeof projection> | null;
  baselineProjection?: ReturnType<typeof projection> | null;
  personalizedTask?: { id: string } | null;
  baselineTask?: { id: string } | null;
}) {
  return {
    homepageCurrentSnapshotProjection: {
      findFirst: vi.fn(async (args: { where: { scope: string } }) =>
        args.where.scope === "PERSONALIZED"
          ? (input.personalizedProjection ?? null)
          : (input.baselineProjection ?? null),
      ),
    },
    homepageGenerationTask: {
      findFirst: vi.fn(
        async (args: {
          where: {
            manifest: {
              scope: "BASELINE" | "PERSONALIZED";
              userId?: string;
            };
          };
        }) =>
          args.where.manifest.scope === "PERSONALIZED"
            ? (input.personalizedTask ?? null)
            : (input.baselineTask ?? null),
      ),
    },
  };
}

describe("首页快照读取", () => {
  it("没有个性化投影但只有基线任务时不标记个性化处理中", async () => {
    const db = database({
      baselineProjection: projection({
        id: "baseline-1",
        scope: "BASELINE",
        manifestId: "manifest-base",
      }),
      baselineTask: { id: "baseline-task-1" },
    });

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "baseline-1",
      source: "BASELINE",
      refreshInProgress: true,
      personalizationPending: false,
    });
  });

  it("当前用户个性化任务进行中且没有个性化投影时标记 pending", async () => {
    const db = database({
      baselineProjection: projection({
        id: "baseline-1",
        scope: "BASELINE",
        manifestId: "manifest-base",
      }),
      personalizedTask: { id: "personalized-task-1" },
    });

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      source: "BASELINE",
      refreshInProgress: true,
      personalizationPending: true,
    });
  });

  it("个性化当前投影存在时即使基线任务进行中也不标记 pending", async () => {
    const db = database({
      personalizedProjection: projection({
        id: "personalized-1",
        scope: "PERSONALIZED",
        manifestId: "manifest-personal",
        userId: "user-1",
        baseManifestId: "manifest-base",
      }),
      baselineProjection: projection({
        id: "baseline-1",
        scope: "BASELINE",
        manifestId: "manifest-base",
      }),
      baselineTask: { id: "baseline-task-1" },
    });

    const result = await getHomePageSnapshot(db as never, "user-1");

    expect(result).toMatchObject({
      snapshotId: "personalized-1",
      source: "PERSONALIZED",
      refreshInProgress: true,
      personalizationPending: false,
    });
  });
});
