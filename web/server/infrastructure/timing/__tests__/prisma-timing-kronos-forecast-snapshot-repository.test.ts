import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";

const forecast = {
  stockCode: "600519",
  asOfDate: "2026-03-06",
  modelName: "NeoQuasar/Kronos-base",
  modelVersion: "NeoQuasar/Kronos-base",
  lookbackDays: 130,
  predictionLength: 60,
  device: "cpu",
  points: [
    {
      tradeDate: "2026-03-09",
      open: 10,
      high: 11,
      low: 9,
      close: 10.6,
      volume: 1000,
      amount: 10000,
    },
  ],
  summary: {
    expectedReturnPct: 6.2,
    maxDrawdownPct: -2.8,
    upsidePct: 7,
    volatilityProxy: 0.2,
    direction: "bullish" as const,
    confidence: 0.7,
  },
  warnings: [],
};

function dbRecord(overrides?: Record<string, unknown>) {
  return {
    id: "snap_1",
    userId: "user_1",
    workflowRunId: "run_1",
    stockCode: "600519",
    stockName: "贵州茅台",
    asOfDate: new Date("2026-03-06T00:00:00.000Z"),
    sourceType: "watchlist",
    sourceId: "wl_1",
    modelName: "NeoQuasar/Kronos-base",
    modelVersion: "NeoQuasar/Kronos-base",
    lookbackDays: 130,
    predictionLength: 60,
    inputBarsHash: "hash_1",
    forecastJson: forecast,
    summaryJson: forecast.summary,
    warnings: [],
    createdAt: new Date("2026-03-06T10:00:00.000Z"),
    ...overrides,
  };
}

describe("PrismaTimingKronosForecastSnapshotRepository", () => {
  it("upserts forecast snapshots using the audit unique key", async () => {
    const upsert = vi.fn().mockResolvedValue(dbRecord());
    const repository = new PrismaTimingKronosForecastSnapshotRepository({
      timingKronosForecastSnapshot: { upsert },
    } as unknown as PrismaClient);

    const result = await repository.upsert({
      userId: "user_1",
      workflowRunId: "run_1",
      stockCode: "600519",
      stockName: "贵州茅台",
      sourceType: "watchlist",
      sourceId: "wl_1",
      inputBarsHash: "hash_1",
      forecast,
    });

    expect(result.summary.expectedReturnPct).toBe(6.2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_stockCode_asOfDate_modelName_predictionLength_inputBarsHash: {
            userId: "user_1",
            stockCode: "600519",
            asOfDate: new Date("2026-03-06T00:00:00.000Z"),
            modelName: "NeoQuasar/Kronos-base",
            predictionLength: 60,
            inputBarsHash: "hash_1",
          },
        },
      }),
    );
  });

  it("gets the latest reusable snapshot for report details", async () => {
    const findFirst = vi.fn().mockResolvedValue(dbRecord());
    const repository = new PrismaTimingKronosForecastSnapshotRepository({
      timingKronosForecastSnapshot: { findFirst },
    } as unknown as PrismaClient);

    const result = await repository.getLatestForStock({
      userId: "user_1",
      stockCode: "600519",
      asOfDate: "2026-03-06",
    });

    expect(result?.stockCode).toBe("600519");
    expect(result?.forecast.points).toHaveLength(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_1",
          stockCode: "600519",
          asOfDate: new Date("2026-03-06T00:00:00.000Z"),
        },
      }),
    );
  });
});
