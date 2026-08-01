import "server-only";

import { createHash } from "node:crypto";
import { env } from "~/env";
import { db } from "~/server/db";
import { PythonMarketHeatmapClient } from "~/server/infrastructure/market/python-market-heatmap-client";

type ProviderRow = Record<string, unknown>;
export type SellSideForecastRow = {
  tsCode: string;
  name: string;
  reportDate: string;
  reportTitle: string | null;
  orgName: string;
  quarter: string;
  eps: number | null;
  netProfit: number | null;
  rating: string | null;
  maxPrice: number | null;
  minPrice: number | null;
};
type ChipPosition = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  close: number;
  cost15: number;
  cost50: number;
  cost85: number;
  weightAvg: number;
  winnerRate: number;
  winnerRateChange5d: number;
  weightAvgChange5d: number;
};

function text(row: ProviderRow, key: string) {
  const value = row[key];
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value);
}
function number(row: ProviderRow, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
}
function toDateText(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}
function stockCodeFromTsCode(tsCode: string) {
  return tsCode.split(".", 1)[0] ?? tsCode;
}
function batches<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function provider(path: string, body: object) {
  const response = await fetch(
    `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/sell-side/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`卖方数据服务异常(${response.status})`);
  return (await response.json()) as {
    data: { items: ProviderRow[]; errors?: unknown[] };
  };
}

export type MoneyFlowSnapshot = {
  market: {
    asOf: string | null;
    history: Array<Record<string, number | string | null>>;
  };
  concepts: {
    asOf: string | null;
    inflows: Array<Record<string, unknown>>;
    outflows: Array<Record<string, unknown>>;
  };
  stocks: {
    asOf: string | null;
    inflows: Array<Record<string, unknown>>;
    outflows: Array<Record<string, unknown>>;
  };
  errors: Record<string, string>;
  meta?: { isStale?: boolean; warnings?: string[] };
};

export async function getMoneyFlowSnapshot(): Promise<MoneyFlowSnapshot> {
  const response = await fetch(
    `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/sell-side/money-flow`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`资金流向数据服务异常(${response.status})`);
  const payload = (await response.json()) as {
    data: MoneyFlowSnapshot;
    meta?: MoneyFlowSnapshot["meta"];
  };
  return { ...payload.data, meta: payload.meta };
}

export async function refreshSellSideOverview() {
  const state = await db.sellSideRefreshState.findUnique({
    where: { id: "global" },
  });
  const today = new Date();
  const start = state?.latestForecastDate
    ? new Date(
        `${state.latestForecastDate.slice(0, 4)}-${state.latestForecastDate.slice(4, 6)}-${state.latestForecastDate.slice(6, 8)}T00:00:00Z`,
      )
    : new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const forecasts = await provider("forecasts", {
    startDate: toDateText(start),
    endDate: toDateText(today),
  });
  const forecastRows = [];
  let latestForecastDate = state?.latestForecastDate ?? null;
  for (const row of forecasts.data.items) {
    const tsCode = text(row, "ts_code");
    const orgName = text(row, "org_name");
    const quarter = text(row, "quarter");
    const reportDate = text(row, "report_date");
    if (!tsCode || !orgName || !quarter || !reportDate) continue;
    const sourceKey = createHash("sha256")
      .update(
        [
          tsCode,
          orgName,
          quarter,
          reportDate,
          text(row, "report_title"),
          text(row, "eps"),
          text(row, "np"),
        ].join("|"),
        "utf8",
      )
      .digest("hex");
    forecastRows.push({
      sourceKey,
      tsCode,
      name: text(row, "name") || tsCode,
      reportDate,
      reportTitle: text(row, "report_title") || null,
      orgName,
      quarter,
      eps: number(row, "eps"),
      netProfit: number(row, "np"),
      rating: text(row, "rating") || null,
      maxPrice: number(row, "max_price"),
      minPrice: number(row, "min_price"),
    });
    latestForecastDate =
      !latestForecastDate || reportDate > latestForecastDate
        ? reportDate
        : latestForecastDate;
  }
  for (const batch of batches(forecastRows, 500)) {
    await db.sellSideEarningsForecast.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }
  const forecastCount = forecastRows.length;
  await db.sellSideRefreshState.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      latestRecommendationMonth: null,
      latestForecastDate,
      lastSuccessfulAt: new Date(),
      lastError: null,
    },
    update: {
      latestRecommendationMonth: null,
      latestForecastDate,
      lastSuccessfulAt: new Date(),
      lastError: null,
    },
  });
  return { forecastCount, latestForecastDate };
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const right = ordered[middle];
  if (right === undefined) return 0;
  if (ordered.length % 2) return right;
  return ((ordered[middle - 1] ?? right) + right) / 2;
}
function futureQuarter(quarter: string) {
  const match = /^(\d{4})Q([1-4])$/i.exec(quarter);
  if (!match) return false;
  const now = new Date();
  return (
    Number(match[1]) > now.getFullYear() ||
    (Number(match[1]) === now.getFullYear() &&
      Number(match[2]) >= Math.floor(now.getMonth() / 3) + 1)
  );
}

function percentChange(latest: number | null, previous: number | null) {
  if (latest == null || previous == null || previous === 0) return null;
  return (latest / previous - 1) * 100;
}

function latestAndPrevious(items: SellSideForecastRow[]) {
  const ordered = [...items].sort((a, b) =>
    a.reportDate.localeCompare(b.reportDate),
  );
  return { latest: ordered.at(-1) ?? null, previous: ordered.at(-2) ?? null };
}

function effectiveForecasts(forecasts: SellSideForecastRow[]) {
  return forecasts.filter(
    (forecast) => futureQuarter(forecast.quarter) && forecast.eps != null,
  );
}

export type SellSideRevision = {
  stockCode: string;
  stockName: string;
  quarter: string;
  revisionPct: number;
  coverageCount: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  latestRating: string | null;
};

export function buildSellSideRevisions(
  forecasts: SellSideForecastRow[],
): SellSideRevision[] {
  const grouped = new Map<string, SellSideForecastRow[]>();
  for (const item of effectiveForecasts(forecasts)) {
    const key = `${item.tsCode}|${item.quarter}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.values()]
    .map((items) => {
      const byOrg = new Map<string, SellSideForecastRow[]>();
      for (const item of items)
        byOrg.set(item.orgName, [...(byOrg.get(item.orgName) ?? []), item]);
      const snapshots = [...byOrg.values()].map(latestAndPrevious);
      const changes = snapshots.flatMap(({ latest, previous }) => {
        const change = percentChange(
          latest?.eps ?? null,
          previous?.eps ?? null,
        );
        return change == null ? [] : [change];
      });
      const latest = snapshots
        .flatMap((snapshot) => (snapshot.latest ? [snapshot.latest] : []))
        .sort((a, b) => b.reportDate.localeCompare(a.reportDate));
      return { changes, latest };
    })
    .filter((item) => item.changes.length > 0 && median(item.changes) > 0)
    .flatMap((item) => {
      const lead = item.latest[0];
      if (!lead) return [];
      const prices = item.latest
        .flatMap((row) => [row.minPrice, row.maxPrice])
        .filter((value): value is number => value != null);
      return [
        {
          stockCode: stockCodeFromTsCode(lead.tsCode),
          stockName: lead.name,
          quarter: lead.quarter,
          revisionPct: median(item.changes),
          coverageCount: item.latest.length,
          targetPriceMin: prices.length ? Math.min(...prices) : null,
          targetPriceMax: prices.length ? Math.max(...prices) : null,
          latestRating: lead.rating ? `${lead.orgName} · ${lead.rating}` : null,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.revisionPct - a.revisionPct ||
        a.stockCode.localeCompare(b.stockCode) ||
        a.quarter.localeCompare(b.quarter),
    );
}

async function getEffectiveForecastRows(stockCode?: string) {
  const now = new Date();
  const quarter = `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`;
  return db.sellSideEarningsForecast.findMany({
    where: {
      quarter: { gte: quarter },
      ...(stockCode
        ? {
            OR: [
              { tsCode: stockCode },
              { tsCode: { startsWith: `${stockCode}.` } },
            ],
          }
        : {}),
    },
    orderBy: { reportDate: "desc" },
    select: {
      tsCode: true,
      name: true,
      reportDate: true,
      reportTitle: true,
      orgName: true,
      quarter: true,
      eps: true,
      netProfit: true,
      rating: true,
      maxPrice: true,
      minPrice: true,
    },
  });
}

export async function listSellSideRevisions(cursor = 0, limit = 20) {
  const [state, forecasts] = await Promise.all([
    db.sellSideRefreshState.findUnique({ where: { id: "global" } }),
    getEffectiveForecastRows(),
  ]);
  const revisions = buildSellSideRevisions(forecasts);
  const items = revisions.slice(cursor, cursor + limit);
  const nextCursor =
    cursor + items.length < revisions.length ? cursor + items.length : null;
  return {
    items,
    nextCursor,
    forecastDate: state?.latestForecastDate ?? null,
    status: state?.lastSuccessfulAt ? "ready" : "pending",
  };
}

export function buildSellSideForecastDetail(
  stockCode: string,
  forecasts: SellSideForecastRow[],
) {
  const grouped = new Map<string, SellSideForecastRow[]>();
  for (const item of forecasts) {
    if (!futureQuarter(item.quarter)) continue;
    grouped.set(item.quarter, [...(grouped.get(item.quarter) ?? []), item]);
  }
  return {
    stockCode,
    stockName: forecasts[0]?.name ?? stockCode,
    periods: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([quarter, items]) => {
        const byOrg = new Map<string, SellSideForecastRow[]>();
        for (const item of items)
          byOrg.set(item.orgName, [...(byOrg.get(item.orgName) ?? []), item]);
        return {
          quarter,
          forecasts: [...byOrg.entries()]
            .map(([orgName, history]) => {
              const { latest, previous } = latestAndPrevious(history);
              if (!latest) return null;
              return {
                orgName,
                reportDate: latest.reportDate,
                reportTitle: latest.reportTitle,
                eps: latest.eps,
                previousEps: previous?.eps ?? null,
                epsChangePct: percentChange(latest.eps, previous?.eps ?? null),
                netProfit: latest.netProfit,
                previousNetProfit: previous?.netProfit ?? null,
                netProfitChangePct: percentChange(
                  latest.netProfit,
                  previous?.netProfit ?? null,
                ),
                rating: latest.rating,
                minPrice: latest.minPrice,
                maxPrice: latest.maxPrice,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .sort((a, b) => a.orgName.localeCompare(b.orgName)),
        };
      }),
  };
}

export async function getSellSideForecastDetail(stockCode: string) {
  return buildSellSideForecastDetail(
    stockCode,
    await getEffectiveForecastRows(stockCode),
  );
}

function chipSignal(item: ChipPosition) {
  if (item.close >= item.cost85) return "站上 85% 成本带，筹码获利面较高";
  if (item.close >= item.cost50) return "位于中位成本带上方";
  if (item.close >= item.cost15) return "接近中位成本，承接待确认";
  return "跌破 15% 成本带，承接待确认";
}

export async function getOverviewInsights(
  userId?: string,
  frozenStockCodes?: string[],
) {
  const [state, forecasts, watchLists, savedCompanies] = await Promise.all([
    db.sellSideRefreshState.findUnique({ where: { id: "global" } }),
    getEffectiveForecastRows(),
    userId
      ? db.watchList.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { stocks: true },
    })
      : [],
    userId
      ? db.savedCompany.findMany({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { stockCode: true },
    })
      : [],
  ]);
  const revisions = buildSellSideRevisions(forecasts).slice(0, 3);
  const codes: string[] = [];
  let chipError: string | null = null;
  const seen = new Set<string>();
  const add = (code: string) => {
    if (!seen.has(code) && codes.length < 10) {
      seen.add(code);
      codes.push(code);
    }
  };
  for (const code of frozenStockCodes ?? []) add(code);
  for (const list of watchLists)
    for (const stock of Array.isArray(list.stocks) ? list.stocks : [])
      if (
        stock &&
        typeof stock === "object" &&
        "stockCode" in stock &&
        typeof stock.stockCode === "string"
      )
        add(stock.stockCode);
  let source = codes.length ? "自选股" : "收藏公司";
  if (!codes.length)
    for (const company of savedCompanies) add(company.stockCode);
  if (!codes.length) {
    source = "热门板块代表股";
    try {
      const heatmap = await new PythonMarketHeatmapClient().getSnapshot();
      for (const concept of [...heatmap.concepts]
        .sort((a, b) => a.hotRank - b.hotRank)
        .slice(0, 3)) {
        for (const stock of concept.stocks.slice(0, 2)) add(stock.stockCode);
      }
    } catch {
      chipError = "热门板块数据暂不可用。";
    }
  }
  let chips: ChipPosition[] = [];
  if (codes.length)
    try {
      chips = (await provider("chip-positions", { stockCodes: codes })).data
        .items as unknown as ChipPosition[];
    } catch {
      chipError = "筹码数据暂不可用。";
    }
  return {
    sellSide: {
      revisions,
      forecastDate: state?.latestForecastDate ?? null,
      status: state?.lastSuccessfulAt ? "ready" : "pending",
    },
    chips: {
      source,
      items: chips.map((item) => ({ ...item, signal: chipSignal(item) })),
      error: chipError,
    },
  };
}
