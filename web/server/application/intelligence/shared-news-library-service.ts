import type { PrismaClient } from "@prisma/client";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";
import type {
  DailyNewsGatewayItem,
  NewsRadarRequest,
  PythonIntelligenceDataClient,
} from "~/server/infrastructure/intelligence/python-intelligence-data-client";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const LEASE_MS = 60_000;
const WAIT_MS = 5_000;

type RadarTargets = Omit<NewsRadarRequest, "days" | "limit" | "endAt"> & {
  days: number;
  limit: number;
  endAt?: string;
};

function shanghaiDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function dayMarker(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function shanghaiDayStart(key: string) {
  return new Date(`${key}T00:00:00+08:00`);
}

function dateKeys(days: number, endAt?: string) {
  const end = endAt ? new Date(endAt) : new Date();
  const endKey = shanghaiDateKey(end);
  const cursor = dayMarker(endKey);
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(cursor);
    value.setUTCDate(value.getUTCDate() - index);
    return value.toISOString().slice(0, 10);
  }).reverse();
}

function asRawItem(value: unknown): DailyNewsGatewayItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const sourceKind = item.sourceKind;
  if (sourceKind !== "fast" && sourceKind !== "major" && sourceKind !== "cctv")
    return null;
  const required = [
    "sourceName",
    "title",
    "content",
    "publishedAt",
    "contentHash",
    "sourceItemId",
  ];
  if (required.some((key) => typeof item[key] !== "string" || !item[key]))
    return null;
  return {
    sourceKind,
    sourceName: item.sourceName as string,
    url: typeof item.url === "string" ? item.url : undefined,
    title: item.title as string,
    content: item.content as string,
    publishedAt: item.publishedAt as string,
    contentHash: item.contentHash as string,
    sourceItemId: item.sourceItemId as string,
  };
}

export class SharedNewsLibraryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dataClient: Pick<
      PythonIntelligenceDataClient,
      "getDailyNews" | "resolveNewsRadar"
    >,
  ) {}

  async collectRadar(
    params: RadarTargets,
  ): Promise<{ news: ThemeNewsItem[]; warnings: string[] }> {
    const keys = dateKeys(Math.min(30, params.days), params.endAt);
    const warnings = (
      await Promise.all(keys.map((key) => this.ensureDay(key)))
    ).flat();
    const from = shanghaiDayStart(keys[0] as string);
    const untilKey = new Date(dayMarker(keys[keys.length - 1] as string));
    untilKey.setUTCDate(untilKey.getUTCDate() + 1);
    const until = shanghaiDayStart(untilKey.toISOString().slice(0, 10));
    const rows = await this.prisma.sharedNewsItem.findMany({
      where: { publishedAt: { gte: from, lt: until } },
      orderBy: { publishedAt: "desc" },
      take: 2000,
    });
    const rawItems = rows
      .map((row) => asRawItem(row.rawPayload))
      .filter((item): item is DailyNewsGatewayItem => item !== null);
    if (rawItems.length === 0)
      return { news: [], warnings: [...warnings, "shared_news_empty"] };
    try {
      const news = await this.dataClient.resolveNewsRadar({
        ...params,
        rawItems,
      });
      return { news, warnings };
    } catch (error) {
      return {
        news: [],
        warnings: [
          ...warnings,
          `shared_news_resolve_failed:${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  private async ensureDay(dateKey: string): Promise<string[]> {
    const marker = dayMarker(dateKey);
    const now = new Date();
    const existing = await this.prisma.sharedNewsDaySync.findUnique({
      where: { date: marker },
    });
    if (existing?.status === "COMPLETED") return [];

    let owned = false;
    if (!existing) {
      try {
        await this.prisma.sharedNewsDaySync.create({
          data: {
            date: marker,
            status: "PENDING",
            attemptedAt: now,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          },
        });
        owned = true;
      } catch {
        // Another workflow created the claim first.
      }
    }
    if (!owned) {
      const claimed = await this.prisma.sharedNewsDaySync.updateMany({
        where: {
          date: marker,
          status: { not: "COMPLETED" },
          OR: [{ status: "FAILED" }, { leaseExpiresAt: { lt: now } }],
        },
        data: {
          status: "PENDING",
          attemptedAt: now,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          warnings: [],
        },
      });
      owned = claimed.count === 1;
    }
    if (!owned) return this.waitForDay(marker, dateKey);

    try {
      const response = await this.dataClient.getDailyNews(
        `${dateKey}T00:00:00+08:00`,
      );
      const warnings = Object.entries(response.sourceStatus)
        .filter(([, success]) => !success)
        .map(([source]) => `minishare_${source}_partial`);
      await this.prisma.$transaction([
        ...response.items.map((item) =>
          this.prisma.sharedNewsItem.upsert({
            where: { sourceItemId: item.sourceItemId },
            create: {
              ...item,
              url: item.url ?? null,
              publishedAt: new Date(item.publishedAt),
              rawPayload: item,
            },
            update: {
              ...item,
              url: item.url ?? null,
              publishedAt: new Date(item.publishedAt),
              rawPayload: item,
            },
          }),
        ),
        this.prisma.sharedNewsDaySync.update({
          where: { date: marker },
          data: {
            status: response.complete ? "COMPLETED" : "FAILED",
            completedAt: response.complete ? new Date() : null,
            leaseExpiresAt: null,
            warnings,
          },
        }),
      ]);
      return warnings;
    } catch (error) {
      const warning = `shared_news_fetch_failed:${dateKey}:${error instanceof Error ? error.message : String(error)}`;
      await this.prisma.sharedNewsDaySync
        .update({
          where: { date: marker },
          data: { status: "FAILED", leaseExpiresAt: null, warnings: [warning] },
        })
        .catch(() => undefined);
      return [warning];
    }
  }

  private async waitForDay(marker: Date, dateKey: string): Promise<string[]> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const current = await this.prisma.sharedNewsDaySync.findUnique({
        where: { date: marker },
      });
      if (current?.status === "COMPLETED") return [];
      if (current?.status === "FAILED") return current.warnings;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return [`shared_news_wait_timeout:${dateKey}`];
  }
}
