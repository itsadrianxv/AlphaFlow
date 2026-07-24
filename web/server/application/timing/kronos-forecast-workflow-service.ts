import { createHash } from "node:crypto";
import type {
  TimingBar,
  TimingCardDraft,
  TimingExecutionCondition,
  TimingKronosForecast,
  TimingSignalData,
  TimingSourceType,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import type { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";

const KRONOS_MISSING_WARNING = "Kronos 预测暂不可用，辅助权重按 0 处理。";
const KRONOS_TIMEFRAMES: TimingTimeframe[] = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "MINUTE_60",
  "MINUTE_30",
  "MINUTE_15",
  "MINUTE_1",
];
const KRONOS_PREDICTION_LENGTHS: Record<TimingTimeframe, number> = {
  DAILY: 60,
  WEEKLY: 12,
  MONTHLY: 6,
  MINUTE_60: 60,
  MINUTE_30: 60,
  MINUTE_15: 60,
  MINUTE_1: 60,
};

const directionLabelMap = {
  bullish: "偏多",
  neutral: "中性",
  bearish: "偏空",
} as const;

function formatDirectionLabel(direction: keyof typeof directionLabelMap) {
  return directionLabelMap[direction] ?? direction;
}

function hashBars(bars: TimingBar[]) {
  const stablePayload = bars.map((bar) => ({
    tradeDate: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount ?? null,
  }));

  return createHash("sha256")
    .update(JSON.stringify(stablePayload))
    .digest("hex");
}

function buildKronosConditions(forecast: TimingKronosForecast): {
  triggerConditions: TimingExecutionCondition[];
  invalidationConditions: TimingExecutionCondition[];
} {
  const expectedReturn = forecast.summary.expectedReturnPct;
  const maxDrawdown = forecast.summary.maxDrawdownPct;
  const actual = `${expectedReturn.toFixed(2)}% / ${maxDrawdown.toFixed(2)}%`;

  return {
    triggerConditions:
      forecast.summary.direction === "bullish" &&
      expectedReturn >= 5 &&
      maxDrawdown > -8
        ? [
            {
              id: "trigger:kronos-forecast",
              kind: "TRIGGER",
              category: "FORECAST",
              label: "Kronos 预测确认",
              metric: "kronosForecast",
              operator: ">=",
              threshold: "预期收益 >= 5%，最大回撤 > -8%",
              actual,
              lookbackDays: forecast.predictionLength,
              status: "TRIGGERED",
              severity: "INFO",
              explanation:
                "Kronos 预测收益回撤结构偏正，可作为辅助确认，不替代价格信号。",
            },
          ]
        : [],
    invalidationConditions:
      forecast.summary.direction === "bearish" ||
      expectedReturn <= -3 ||
      maxDrawdown <= -10
        ? [
            {
              id: "invalidation:kronos-forecast",
              kind: "INVALIDATION",
              category: "FORECAST",
              label: "Kronos 预测转弱",
              metric: "kronosForecast",
              operator: "<=",
              threshold: "预期收益 <= -3% 或最大回撤 <= -10%",
              actual,
              lookbackDays: forecast.predictionLength,
              status: "TRIGGERED",
              severity: "WARNING",
              explanation:
                "Kronos 预测显示收益回撤结构偏弱，执行进攻动作需要降级确认。",
            },
          ]
        : [],
  };
}

export class KronosForecastWorkflowService {
  constructor(
    private readonly deps: {
      client: Pick<KronosForecastClient, "forecastBatch">;
      snapshotRepository: Pick<
        PrismaTimingKronosForecastSnapshotRepository,
        "upsert" | "getLatestForStock"
      >;
    },
  ) {}

  async enrichCards(params: {
    userId: string;
    workflowRunId: string;
    sourceType: TimingSourceType;
    sourceId: string;
    cards: TimingCardDraft[];
    signalSnapshots: TimingSignalData[];
    predictionLength?: number;
  }): Promise<{ cards: TimingCardDraft[]; warnings: string[] }> {
    const snapshotsWithBars = params.signalSnapshots.filter(
      (snapshot) => (snapshot.bars?.length ?? 0) > 0,
    );
    if (snapshotsWithBars.length === 0) {
      return {
        cards: this.attachMissingWarnings(params.cards),
        warnings: [KRONOS_MISSING_WARNING],
      };
    }

    try {
      const responses = await Promise.all(
        KRONOS_TIMEFRAMES.map(async (timeframe) => {
          const items = snapshotsWithBars
            .map((snapshot) => ({
              stockCode: snapshot.stockCode,
              timeframe,
              bars:
                snapshot.barsByTimeframe?.[timeframe] ??
                (timeframe === "DAILY" ? (snapshot.bars ?? []) : []),
            }))
            .filter((item) => item.bars.length >= 120);
          if (items.length === 0) {
            return { items: [], errors: [] };
          }
          const uniformLength = Math.min(
            ...items.map((item) => item.bars.length),
          );
          return this.deps.client.forecastBatch({
            items: items.map((item) => ({
              ...item,
              bars: item.bars.slice(-uniformLength),
            })),
            predictionLength:
              params.predictionLength ?? KRONOS_PREDICTION_LENGTHS[timeframe],
          });
        }),
      );
      const response = {
        items: responses.flatMap((item) => item.items),
        errors: responses.flatMap((item) => item.errors),
      };

      const snapshotByCode = new Map(
        params.signalSnapshots.map((snapshot) => [
          snapshot.stockCode,
          snapshot,
        ]),
      );
      const forecastByKey = new Map<string, TimingKronosForecast>();
      const warnings = response.errors.map(
        (error) => `${error.stockCode}:${error.code}:${error.message}`,
      );

      await Promise.all(
        response.items.map(async (forecast) => {
          const signalSnapshot = snapshotByCode.get(forecast.stockCode);
          const bars = signalSnapshot?.bars ?? [];
          if (!signalSnapshot || bars.length === 0) {
            return;
          }

          const persisted = await this.deps.snapshotRepository.upsert({
            userId: params.userId,
            workflowRunId: params.workflowRunId,
            stockCode: forecast.stockCode,
            stockName: signalSnapshot.stockName,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            inputBarsHash: hashBars(bars),
            forecast,
          });
          forecastByKey.set(
            `${forecast.stockCode}:${forecast.timeframe}`,
            persisted.forecast,
          );
        }),
      );

      return {
        cards: params.cards.map((card) => {
          const forecasts = Object.fromEntries(
            KRONOS_TIMEFRAMES.flatMap((timeframe) => {
              const forecast = forecastByKey.get(
                `${card.stockCode}:${timeframe}`,
              );
              return forecast ? [[timeframe, forecast.summary]] : [];
            }),
          ) as Partial<
            Record<TimingTimeframe, TimingKronosForecast["summary"]>
          >;
          const forecast = forecastByKey.get(`${card.stockCode}:DAILY`);
          if (!forecast) {
            return {
              ...this.attachMissingWarning(card),
              reasoning: {
                ...this.attachMissingWarning(card).reasoning,
                kronosForecasts: forecasts,
              },
            };
          }
          const kronosConditions = buildKronosConditions(forecast);
          return {
            ...card,
            reasoning: {
              ...card.reasoning,
              signalContext: {
                ...card.reasoning.signalContext,
                triggerConditions: [
                  ...(card.reasoning.signalContext.triggerConditions ?? []),
                  ...kronosConditions.triggerConditions,
                ],
                invalidationConditions: [
                  ...(card.reasoning.signalContext.invalidationConditions ??
                    []),
                  ...kronosConditions.invalidationConditions,
                ],
                triggerNotes: [
                  ...card.reasoning.signalContext.triggerNotes,
                  ...kronosConditions.triggerConditions.map(
                    (condition) => condition.explanation,
                  ),
                ],
                invalidationNotes: [
                  ...card.reasoning.signalContext.invalidationNotes,
                  ...kronosConditions.invalidationConditions.map(
                    (condition) => condition.explanation,
                  ),
                ],
              },
              kronosForecast: forecast.summary,
              kronosForecasts: forecasts,
              kronosWarnings: forecast.warnings,
              actionRationale: `${card.reasoning.actionRationale} Kronos 预测：${formatDirectionLabel(forecast.summary.direction)}，预期收益 ${forecast.summary.expectedReturnPct.toFixed(2)}%，最大回撤 ${forecast.summary.maxDrawdownPct.toFixed(2)}%。`,
            },
          };
        }),
        warnings,
      };
    } catch (error) {
      return {
        cards: this.attachMissingWarnings(params.cards),
        warnings: [
          `${KRONOS_MISSING_WARNING} ${(error as Error).message}`.trim(),
        ],
      };
    }
  }

  private attachMissingWarnings(cards: TimingCardDraft[]) {
    return cards.map((card) => this.attachMissingWarning(card));
  }

  private attachMissingWarning(card: TimingCardDraft): TimingCardDraft {
    return {
      ...card,
      reasoning: {
        ...card.reasoning,
        kronosWarnings: [
          ...new Set([
            ...(card.reasoning.kronosWarnings ?? []),
            KRONOS_MISSING_WARNING,
          ]),
        ],
      },
    };
  }
}
