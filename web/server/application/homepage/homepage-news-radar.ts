import type { PrismaClient } from "@prisma/client";
import type {
  ImpactMappingResult,
  ImpactRadarEvent,
} from "~/server/domain/intelligence/impact-mapping";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";

type HomepageNewsDb = PrismaClient;
const HOMEPAGE_NEWS_RADAR_EVENT_LIMIT = 50;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function newsItem(input: {
  revisionId: string;
  valueText: string | null;
  valueJson: unknown;
  sourcePublishedAt: Date | null;
  raw: unknown;
}): ThemeNewsItem | null {
  const raw = record(input.raw);
  const content =
    text(raw.content) || text(input.valueText) || text(input.valueJson);
  const title = text(raw.title) || content.slice(0, 42);
  const publishedAt =
    text(raw.publishedAt) ||
    text(raw.published_at) ||
    text(raw.pub_time) ||
    input.sourcePublishedAt?.toISOString() ||
    "";
  if (!title || !content || !publishedAt) return null;
  return {
    id: text(raw.sourceItemId) || input.revisionId,
    title,
    summary: content.slice(0, 180),
    content,
    source: text(raw.sourceName) || text(raw.src) || "新闻源",
    publishedAt,
    sentiment: "neutral",
    relevanceScore: 0.5,
    relatedStocks: [],
    scopeTags: ["macro"],
    eventType: "news",
    matchReason: "首页专业市场基线新闻",
    url: text(raw.url) || undefined,
    sourceKind: "major",
    analysisStatus: "partial",
    warnings: [],
  };
}

export async function readHomepageNewsRadar(
  db: HomepageNewsDb,
  snapshotId: string,
  userId?: string,
) {
  const snapshot = await db.homepageSnapshot.findFirst({
    where: {
      id: snapshotId,
      ...(userId ? { OR: [{ scope: "BASELINE" }, { userId }] } : {}),
    },
    select: {
      id: true,
      generatedAt: true,
      payloadJson: true,
      manifest: {
        select: {
          items: {
            where: { datasetKey: "news.major" },
            select: {
              settlement: { select: { id: true } },
            },
          },
          baseManifest: {
            select: {
              items: {
                where: { datasetKey: "news.major" },
                select: {
                  settlement: { select: { id: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!snapshot) return null;
  if (!snapshot.manifest) {
    const legacy = record(snapshot.payloadJson).impactMapping;
    const legacyResult = record(legacy) as Partial<ImpactMappingResult>;
    return Array.isArray(legacyResult.events)
      ? {
          snapshotId: snapshot.id,
          generatedAt: snapshot.generatedAt,
          result: legacyResult as ImpactMappingResult,
        }
      : null;
  }
  const items = [
    ...snapshot.manifest.items,
    ...(snapshot.manifest.baseManifest?.items ?? []),
  ];
  const settlementIds = items.flatMap((item) =>
    item.settlement?.id ? [item.settlement.id] : [],
  );
  const revisions =
    settlementIds.length > 0
      ? await db.homepageDataManifestItemSettlementRevision.findMany({
          where: { settlementId: { in: settlementIds } },
          orderBy: [
            { observationRevision: { sourcePublishedAt: "desc" } },
            { ordinal: "asc" },
          ],
          take: HOMEPAGE_NEWS_RADAR_EVENT_LIMIT,
          select: {
            observationRevision: {
              select: {
                id: true,
                valueText: true,
                valueJson: true,
                sourcePublishedAt: true,
                revisionSources: {
                  take: 1,
                  select: {
                    sourceAssertion: {
                      select: { rawRecordJson: true },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
  const events: ImpactRadarEvent[] = revisions
    .flatMap(({ observationRevision }) => {
      const event = newsItem({
        revisionId: observationRevision.id,
        valueText: observationRevision.valueText,
        valueJson: observationRevision.valueJson,
        sourcePublishedAt: observationRevision.sourcePublishedAt,
        raw: observationRevision.revisionSources[0]?.sourceAssertion
          .rawRecordJson,
      });
      return event
        ? [{ event, impactEdges: [], portfolioHits: [], importanceScore: 0.5 }]
        : [];
    })
    .sort((left, right) =>
      right.event.publishedAt.localeCompare(left.event.publishedAt),
    );
  const result: ImpactMappingResult = {
    mode: "overview",
    analysisStatus: "partial",
    asOf: snapshot.generatedAt.toISOString(),
    context: {
      watchLists: [],
      companies: [],
      industries: [],
      hypotheses: [],
    },
    events,
    impactEdges: [],
    timeline: [],
    scenarios: [],
    evidenceCitations: [],
    warnings: [],
    featuredEventIds: events.slice(0, 3).map((item) => item.event.id),
  };
  return { snapshotId: snapshot.id, generatedAt: snapshot.generatedAt, result };
}
