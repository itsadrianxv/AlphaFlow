import { describe, expect, it } from "vitest";

import {
  evaluateTimingBacktestQuality,
  simulateTimingBacktestExecution,
  summarizeTimingBacktestPerformance,
} from "~/server/domain/timing/services/timing-backtest-policy";
import { createTimingPresetConfigV2 } from "~/server/domain/timing/strategy-v2";

describe("择时v2历史回放策略", () => {
  const config = createTimingPresetConfigV2("BREAKOUT");

  it("只按数据质量执行发布门禁", () => {
    expect(
      evaluateTimingBacktestQuality({
        config,
        coveredMonths: 24,
        stockCount: 5,
        triggeredEvents: 30,
        primaryCompletenessPct: 95,
        noLookaheadPassed: true,
      }),
    ).toMatchObject({ gatePassed: true, failures: [] });

    const failed = evaluateTimingBacktestQuality({
      config,
      coveredMonths: 23,
      stockCount: 4,
      triggeredEvents: 29,
      primaryCompletenessPct: 94.9,
      noLookaheadPassed: false,
    });
    expect(failed.gatePassed).toBe(false);
    expect(failed.failures).toHaveLength(5);
  });

  it("盘后信号优先按下一交易日竞价VWAP并计入成本", () => {
    const result = simulateTimingBacktestExecution(
      {
        action: "ENTER",
        signalDate: "2026-07-20",
        nextTradingDay: {
          tradeDate: "2026-07-21",
          open: 10,
          auctionVwap: 10.1,
          upLimit: 11,
          downLimit: 9,
        },
        exitBar: {
          tradeDate: "2026-07-28",
          close: 11,
          high: 11.5,
          low: 9.8,
        },
        benchmarkReturnPct: 2,
      },
      config.backtestPolicy,
    );

    expect(result.filled).toBe(true);
    expect(result.priceSource).toBe("AUCTION_VWAP");
    expect(result.fillPrice).toBeGreaterThan(10.1);
    expect(result.netReturnPct).toBeLessThan(result.grossReturnPct ?? 0);
  });

  it("缺失竞价时回退开盘价并阻止涨停买入", () => {
    const fallback = simulateTimingBacktestExecution(
      {
        action: "ENTER",
        signalDate: "2026-07-20",
        nextTradingDay: { tradeDate: "2026-07-21", open: 10 },
        exitBar: { tradeDate: "2026-07-28", close: 10.5, high: 11, low: 9.8 },
      },
      config.backtestPolicy,
    );
    expect(fallback.priceSource).toBe("OPEN");

    const blocked = simulateTimingBacktestExecution(
      {
        action: "ENTER",
        signalDate: "2026-07-20",
        nextTradingDay: {
          tradeDate: "2026-07-21",
          open: 11,
          auctionVwap: 11,
          upLimit: 11,
        },
        exitBar: { tradeDate: "2026-07-28", close: 12, high: 12, low: 10.5 },
      },
      config.backtestPolicy,
    );
    expect(blocked).toMatchObject({ filled: false });
  });

  it("拒绝同日成交以防止未来数据穿越", () => {
    const result = simulateTimingBacktestExecution(
      {
        action: "ENTER",
        signalDate: "2026-07-20",
        nextTradingDay: { tradeDate: "2026-07-20", open: 10 },
        exitBar: { tradeDate: "2026-07-28", close: 11, high: 11, low: 9 },
      },
      config.backtestPolicy,
    );
    expect(result.blockedReason).toContain("晚于盘后信号日期");
  });

  it("汇总命中率、超额收益和路径指标", () => {
    const performance = summarizeTimingBacktestPerformance([
      {
        filled: true,
        netReturnPct: 5,
        excessReturnPct: 3,
        maxFavorableExcursionPct: 7,
        maxAdverseExcursionPct: -2,
      },
      {
        filled: true,
        netReturnPct: -1,
        excessReturnPct: -2,
        maxFavorableExcursionPct: 2,
        maxAdverseExcursionPct: -4,
      },
      { filled: false },
    ]);
    expect(performance).toMatchObject({
      completedTrades: 2,
      hitRatePct: 50,
      averageReturnPct: 2,
      averageExcessReturnPct: 0.5,
    });
  });
});
