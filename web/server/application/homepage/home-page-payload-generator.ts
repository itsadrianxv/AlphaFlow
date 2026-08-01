import type { Prisma } from "@prisma/client";
import type { HomePagePayload } from "~/contracts/homepage";
import {
  getMoneyFlowSnapshot,
  getOverviewInsights,
} from "~/server/application/overview/sell-side-overview-service";
import type {
  ImpactMappingResult,
  ImpactRadarEvent,
} from "~/server/domain/intelligence/impact-mapping";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PythonMarketHeatmapClient } from "~/server/infrastructure/market/python-market-heatmap-client";

type FrozenSelection = {
  watchList?: {
    id: string;
    name: string;
    stocks: unknown;
  } | null;
  company?: {
    id: string;
    stockCode: string;
    companyName: string;
  } | null;
  industry?: { id: string; name: string } | null;
};

function parseStocks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return typeof record.stockCode === "string"
      ? [
          {
            stockCode: record.stockCode,
            stockName:
              typeof record.stockName === "string"
                ? record.stockName
                : record.stockCode,
          },
        ]
      : [];
  });
}

function buildEmbeddedImpactMapping(
  news: Awaited<ReturnType<PythonIntelligenceDataClient["getNewsRadar"]>>,
  selection: FrozenSelection,
): ImpactMappingResult {
  const companies = [
    ...parseStocks(selection.watchList?.stocks).map((stock) => ({
      stockCode: stock.stockCode,
      companyName: stock.stockName,
      aliases: [],
    })),
    ...(selection.company
      ? [
          {
            id: selection.company.id,
            stockCode: selection.company.stockCode,
            companyName: selection.company.companyName,
            aliases: [],
          },
        ]
      : []),
  ];
  const industries = selection.industry
    ? [
        {
          id: selection.industry.id,
          name: selection.industry.name,
          aliases: [],
        },
      ]
    : [];
  const events: ImpactRadarEvent[] = news.map((event) => ({
    event,
    impactEdges: [],
    portfolioHits: [],
    importanceScore: 0.5,
    analysis: {
      timeline: [],
      scenarios: [],
      warnings: ["当前为首页嵌入式快照；深度影响请按需生成。"],
    },
  }));
  return {
    mode: "overview",
    analysisStatus: "partial",
    asOf: new Date().toISOString(),
    context: {
      watchLists: selection.watchList
        ? [
            {
              id: selection.watchList.id,
              name: selection.watchList.name,
              stocks: parseStocks(selection.watchList.stocks),
            },
          ]
        : [],
      companies,
      industries,
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
}

export class HomePagePayloadGenerator {
  async generate(input: {
    selectionJson: Prisma.JsonValue;
  }): Promise<{ payload: HomePagePayload; dataAsOf: string }> {
    const selection = (input.selectionJson ?? {}) as FrozenSelection;
    const selectedStocks = parseStocks(selection.watchList?.stocks);
    const stockCodes = selectedStocks.length
      ? selectedStocks.map((item) => item.stockCode)
      : selection.company
        ? [selection.company.stockCode]
        : [];
    const companies = [
      ...selectedStocks.map((stock) => ({
        stockCode: stock.stockCode,
        companyName: stock.stockName,
        aliases: [],
      })),
      ...(selection.company ? [{ ...selection.company, aliases: [] }] : []),
    ];
    const industries = selection.industry
      ? [{ name: selection.industry.name, aliases: [] }]
      : [];
    const intelligence = new PythonIntelligenceDataClient();
    const [heatmap, overviewInsights, moneyFlow, news] = await Promise.all([
      new PythonMarketHeatmapClient().getSnapshot(),
      getOverviewInsights(undefined, stockCodes),
      getMoneyFlowSnapshot(),
      intelligence.getNewsRadar({
        days: 7,
        limit: 50,
        companies,
        industries,
        includeMacro: true,
      }),
    ]);
    return {
      payload: {
        heatmap,
        overviewInsights,
        moneyFlow,
        impactMapping: buildEmbeddedImpactMapping(news, selection),
      },
      dataAsOf: heatmap.tradeDate,
    };
  }
}
