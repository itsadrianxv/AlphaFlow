import { describe, expect, it, vi } from "vitest";
import { readHomepageNewsRadar } from "~/server/application/homepage/homepage-news-radar";

describe("首页新闻雷达缓存读取", () => {
  it("从当前快照绑定的 news.major 修订按数据库限量构建雷达", async () => {
    const findFirst = vi.fn(async (_query: unknown) => ({
      id: "snapshot-1",
      generatedAt: new Date("2026-08-04T08:00:00.000Z"),
      payloadJson: {},
      manifest: {
        baseManifest: null,
        items: [
          {
            settlement: { id: "settlement-1" },
          },
        ],
      },
    }));
    const findMany = vi.fn(async (_query: unknown) => [
      {
        observationRevision: {
          id: "revision-1",
          valueText: "完整正文",
          valueJson: null,
          sourcePublishedAt: new Date("2026-08-04T07:30:00.000Z"),
          revisionSources: [
            {
              sourceAssertion: {
                rawRecordJson: {
                  sourceItemId: "news-1",
                  title: "重大产业新闻",
                  content: "完整正文",
                  sourceName: "测试新闻源",
                  publishedAt: "2026-08-04T07:30:00.000Z",
                  url: "https://example.test/news-1",
                },
              },
            },
          ],
        },
      },
    ]);

    const cached = await readHomepageNewsRadar(
      {
        homepageSnapshot: { findFirst },
        homepageDataManifestItemSettlementRevision: { findMany },
      } as never,
      "snapshot-1",
      "user-1",
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          manifest: expect.objectContaining({
            select: expect.objectContaining({
              items: expect.objectContaining({
                select: {
                  settlement: { select: { id: true } },
                },
              }),
            }),
          }),
        }),
      }),
    );
    const snapshotQuery = findFirst.mock.calls[0]?.[0] as unknown;
    expect(JSON.stringify(snapshotQuery)).not.toContain("revisions");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settlementId: { in: ["settlement-1"] } },
        orderBy: [
          { observationRevision: { sourcePublishedAt: "desc" } },
          { ordinal: "asc" },
        ],
        take: 50,
      }),
    );
    expect(cached).toMatchObject({
      snapshotId: "snapshot-1",
      result: {
        mode: "overview",
        events: [
          {
            event: {
              id: "news-1",
              title: "重大产业新闻",
              content: "完整正文",
              source: "测试新闻源",
              sourceKind: "major",
            },
          },
        ],
      },
    });
  });

  it("个性化快照继续读取固定父基线 manifest 的 news.major", async () => {
    const findFirst = vi.fn(async (_query: unknown) => ({
      id: "snapshot-2",
      generatedAt: new Date("2026-08-04T08:00:00.000Z"),
      payloadJson: {},
      manifest: {
        items: [{ settlement: { id: "personal-news" } }],
        baseManifest: {
          items: [{ settlement: { id: "base-news" } }],
        },
      },
    }));
    const findMany = vi.fn(async (_query: unknown) => []);

    await readHomepageNewsRadar(
      {
        homepageSnapshot: { findFirst },
        homepageDataManifestItemSettlementRevision: { findMany },
      } as never,
      "snapshot-2",
      "user-1",
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settlementId: { in: ["personal-news", "base-news"] } },
        take: 50,
      }),
    );
  });
});
