import { createHash } from "node:crypto";
import type {
  TimingBar,
  TimingCardDraft,
  TimingKronosForecast,
  TimingSignalData,
  TimingSourceType,
} from "~/server/domain/timing/types";
import type { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import type { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";

const KRONOS_MISSING_WARNING =
  "Kronos forecast unavailable; auxiliary weight treated as 0.";

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
      const response = await this.deps.client.forecastBatch({
        items: snapshotsWithBars.map((snapshot) => ({
          stockCode: snapshot.stockCode,
          bars: snapshot.bars ?? [],
        })),
        predictionLength: params.predictionLength,
      });

      const snapshotByCode = new Map(
        params.signalSnapshots.map((snapshot) => [
          snapshot.stockCode,
          snapshot,
        ]),
      );
      const forecastByCode = new Map<string, TimingKronosForecast>();
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
          forecastByCode.set(forecast.stockCode, persisted.forecast);
        }),
      );

      return {
        cards: params.cards.map((card) => {
          const forecast = forecastByCode.get(card.stockCode);
          if (!forecast) {
            return this.attachMissingWarning(card);
          }
          return {
            ...card,
            reasoning: {
              ...card.reasoning,
              kronosForecast: forecast.summary,
              kronosWarnings: forecast.warnings,
              actionRationale: `${card.reasoning.actionRationale} Kronos forecast: ${forecast.summary.direction}, expected return ${forecast.summary.expectedReturnPct.toFixed(2)}%, max drawdown ${forecast.summary.maxDrawdownPct.toFixed(2)}%.`,
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
