import { createHash } from "node:crypto";
import {
  KRONOS_MIN_LOOKBACK_BARS,
  KRONOS_PREDICTION_LENGTHS,
} from "~/server/application/timing/kronos-forecast-policy";
import type {
  TimingBar,
  TimingForecastSet,
  TimingModelEvidence,
  TimingSignalSnapshotRecord,
  TimingSourceType,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import type { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";

export type KronosResearchForecastResult = {
  forecastsByStock: Map<string, TimingForecastSet>;
  evidenceByStock: Map<string, TimingModelEvidence>;
  warnings: string[];
};

function hashBars(bars: TimingBar[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        bars.map(({ tradeDate, open, high, low, close, volume, amount }) => ({
          tradeDate,
          open,
          high,
          low,
          close,
          volume,
          amount: amount ?? null,
        })),
      ),
    )
    .digest("hex");
}

function classifyError(
  code: string,
): Pick<TimingModelEvidence, "status" | "retryable"> {
  if (code === "kronos_disabled")
    return { status: "MODEL_DISABLED", retryable: false };
  if (
    ["timeout", "service_unavailable", "kronos_unavailable"].some((value) =>
      code.includes(value),
    )
  ) {
    return { status: "SERVICE_UNAVAILABLE", retryable: true };
  }
  return { status: "PREDICTION_FAILED", retryable: true };
}

export class KronosResearchForecastModule {
  constructor(
    private readonly deps: {
      client: Pick<KronosForecastClient, "forecastBatch">;
      snapshotRepository: Pick<
        PrismaTimingKronosForecastSnapshotRepository,
        "upsert"
      >;
    },
  ) {}

  async generateForResearchRun(params: {
    userId: string;
    workflowRunId?: string;
    researchRunId: string;
    sourceType: TimingSourceType;
    sourceId: string;
    signalSnapshots: TimingSignalSnapshotRecord[];
    requestedTimeframes: TimingTimeframe[];
  }): Promise<KronosResearchForecastResult> {
    const forecastsByStock = new Map<string, TimingForecastSet>();
    const evidenceByStock = new Map<string, TimingModelEvidence>();
    const warnings: string[] = [];

    for (const snapshot of params.signalSnapshots) {
      const inputBars = Math.max(
        ...params.requestedTimeframes.map(
          (timeframe) => this.barsFor(snapshot, timeframe).length,
        ),
        0,
      );
      evidenceByStock.set(snapshot.stockCode, {
        status:
          inputBars < KRONOS_MIN_LOOKBACK_BARS
            ? "INSUFFICIENT_HISTORY"
            : "PREDICTION_FAILED",
        inputBars,
        requestedTimeframes: params.requestedTimeframes,
        availableTimeframes: [],
        message:
          inputBars < KRONOS_MIN_LOOKBACK_BARS
            ? `Kronos 预测至少需要 ${KRONOS_MIN_LOOKBACK_BARS} 根 K 线，当前仅有 ${inputBars} 根。`
            : "Kronos 服务未返回预测结果。",
        retryable: inputBars >= KRONOS_MIN_LOOKBACK_BARS,
        alignment: "UNAVAILABLE",
        timeframeConsistency: "UNAVAILABLE",
        confidenceAdjustment: 0,
        timeframeResults: Object.fromEntries(
          params.requestedTimeframes.map((timeframe) => {
            const barsCount = this.barsFor(snapshot, timeframe).length;
            return [
              timeframe,
              {
                status:
                  barsCount < KRONOS_MIN_LOOKBACK_BARS
                    ? "INSUFFICIENT_HISTORY"
                    : "PREDICTION_FAILED",
                inputBars: barsCount,
                message:
                  barsCount < KRONOS_MIN_LOOKBACK_BARS
                    ? `当前仅有 ${barsCount} 根 K 线。`
                    : "尚未返回预测结果。",
                retryable: barsCount >= KRONOS_MIN_LOOKBACK_BARS,
              },
            ];
          }),
        ),
      });
    }

    for (const timeframe of params.requestedTimeframes) {
      const eligible = params.signalSnapshots
        .map((snapshot) => ({
          snapshot,
          bars: this.barsFor(snapshot, timeframe),
        }))
        .filter((item) => item.bars.length >= KRONOS_MIN_LOOKBACK_BARS);
      if (!eligible.length) continue;
      const uniformLength = Math.min(
        ...eligible.map((item) => item.bars.length),
      );
      try {
        const result = await this.deps.client.forecastBatch({
          items: eligible.map((item) => ({
            stockCode: item.snapshot.stockCode,
            timeframe,
            bars: item.bars.slice(-uniformLength),
          })),
          predictionLength: KRONOS_PREDICTION_LENGTHS[timeframe],
        });
        for (const error of result.errors) {
          const classification = classifyError(error.code);
          const current = evidenceByStock.get(error.stockCode);
          const evidence =
            current ?? this.emptyEvidence(params.requestedTimeframes);
          evidence.timeframeResults[timeframe] = {
            ...classification,
            inputBars: evidence.timeframeResults[timeframe]?.inputBars ?? 0,
            message: error.message,
          };
          warnings.push(
            `${error.stockCode}:${timeframe}:${error.code}:${error.message}`,
          );
        }
        await Promise.all(
          result.items.map(async (forecast) => {
            const item = eligible.find(
              (candidate) =>
                candidate.snapshot.stockCode === forecast.stockCode,
            );
            if (!item) return;
            const inputBars = item.bars.slice(-uniformLength);
            const persisted = await this.deps.snapshotRepository.upsert({
              userId: params.userId,
              workflowRunId: params.workflowRunId,
              researchRunId: params.researchRunId,
              stockCode: item.snapshot.stockCode,
              stockName: item.snapshot.stockName,
              sourceType: params.sourceType,
              sourceId: params.sourceId,
              inputBarsHash: hashBars(inputBars),
              forecast,
            });
            const set = forecastsByStock.get(forecast.stockCode) ?? {};
            set[forecast.timeframe] = {
              snapshotId: persisted.id,
              forecast: persisted.forecast,
            };
            forecastsByStock.set(forecast.stockCode, set);
            const availableTimeframes = Object.keys(set) as TimingTimeframe[];
            const evidence =
              evidenceByStock.get(forecast.stockCode) ??
              this.emptyEvidence(params.requestedTimeframes);
            evidence.availableTimeframes = availableTimeframes;
            evidence.timeframeResults[timeframe] = {
              status: "AVAILABLE",
              inputBars: inputBars.length,
              message: "预测快照已冻结。",
              retryable: false,
            };
          }),
        );
      } catch (error) {
        for (const item of eligible) {
          const current = evidenceByStock.get(item.snapshot.stockCode);
          const evidence =
            current ?? this.emptyEvidence(params.requestedTimeframes);
          evidence.timeframeResults[timeframe] = {
            status: "SERVICE_UNAVAILABLE",
            inputBars: item.bars.length,
            message: `Kronos 预测暂不可用：${(error as Error).message}`,
            retryable: true,
          };
        }
        warnings.push(
          `Kronos ${timeframe} 批量预测失败：${(error as Error).message}`,
        );
      }
    }
    for (const [stockCode, evidence] of evidenceByStock) {
      const results = Object.entries(evidence.timeframeResults) as Array<
        [
          TimingTimeframe,
          NonNullable<TimingModelEvidence["timeframeResults"][TimingTimeframe]>,
        ]
      >;
      const available = results.filter(
        ([, result]) => result.status === "AVAILABLE",
      );
      const primary = evidence.timeframeResults.DAILY ?? results[0]?.[1];
      evidence.status = available.length
        ? "AVAILABLE"
        : (primary?.status ?? "PREDICTION_FAILED");
      evidence.inputBars = primary?.inputBars ?? 0;
      evidence.retryable =
        available.length === 0 &&
        results.some(([, result]) => result.retryable);
      evidence.message = results
        .map(([timeframe, result]) => `${timeframe}：${result.message}`)
        .join(" ");
      evidenceByStock.set(stockCode, evidence);
    }
    return { forecastsByStock, evidenceByStock, warnings };
  }

  private barsFor(
    snapshot: TimingSignalSnapshotRecord,
    timeframe: TimingTimeframe,
  ) {
    return (
      snapshot.barsByTimeframe?.[timeframe] ??
      (timeframe === "DAILY" ? (snapshot.bars ?? []) : [])
    );
  }

  private emptyEvidence(
    requestedTimeframes: TimingTimeframe[],
  ): TimingModelEvidence {
    return {
      status: "PREDICTION_FAILED",
      inputBars: 0,
      requestedTimeframes,
      availableTimeframes: [],
      message: "Kronos 服务未返回预测结果。",
      retryable: true,
      alignment: "UNAVAILABLE",
      timeframeConsistency: "UNAVAILABLE",
      confidenceAdjustment: 0,
      timeframeResults: {},
    };
  }
}
