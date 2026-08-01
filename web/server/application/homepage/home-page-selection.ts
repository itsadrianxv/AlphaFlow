import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type SelectionDb = Pick<
  PrismaClient,
  "watchList" | "savedCompany" | "savedIndustry"
>;

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
}

export function fingerprintHomePageSelection(selection: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeJson(selection)))
    .digest("hex");
}

export async function resolveHomePageSelection(
  db: SelectionDb,
  userId: string,
) {
  const [watchList, company, industry] = await Promise.all([
    db.watchList.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, stocks: true, updatedAt: true },
    }),
    db.savedCompany.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        stockCode: true,
        companyName: true,
        updatedAt: true,
      },
    }),
    db.savedIndustry.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, source: true, updatedAt: true },
    }),
  ]);
  const selection = {
    watchList: watchList
      ? {
          id: watchList.id,
          name: watchList.name,
          stocks: watchList.stocks,
        }
      : null,
    company: company
      ? {
          id: company.id,
          stockCode: company.stockCode,
          companyName: company.companyName,
        }
      : null,
    industry: industry
      ? {
          id: industry.id,
          name: industry.name,
          source: industry.source,
        }
      : null,
  } satisfies Prisma.InputJsonObject;
  const personalized = Boolean(watchList || company || industry);
  return {
    selection,
    personalized,
    fingerprint: fingerprintHomePageSelection(selection),
  };
}
