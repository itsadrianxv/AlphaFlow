import type {
  TimingAction,
  TimingBacktestPerformanceMetrics,
  TimingBacktestQualityMetrics,
  TimingPresetConfigV2,
} from "~/server/domain/timing/types";

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function evaluateTimingBacktestQuality(params: {
  config: TimingPresetConfigV2;
  coveredMonths: number;
  stockCount: number;
  triggeredEvents: number;
  primaryCompletenessPct: number;
  noLookaheadPassed: boolean;
}): TimingBacktestQualityMetrics {
  const policy = params.config.backtestPolicy;
  const failures: string[] = [];
  if (params.coveredMonths < policy.minimumMonths) {
    failures.push(`历史覆盖不足${policy.minimumMonths}个月。`);
  }
  if (params.stockCount < policy.minimumStocks) {
    failures.push(`股票数量不足${policy.minimumStocks}只。`);
  }
  if (params.triggeredEvents < policy.minimumTriggeredEvents) {
    failures.push(`完整触发事件不足${policy.minimumTriggeredEvents}个。`);
  }
  if (params.primaryCompletenessPct < policy.minimumPrimaryCompletenessPct) {
    failures.push(`主判据完整率低于${policy.minimumPrimaryCompletenessPct}%。`);
  }
  if (!params.noLookaheadPassed) failures.push("检测到未来数据引用。");
  return { ...params, gatePassed: failures.length === 0, failures };
}

export type TimingBacktestExecutionInput = {
  action: TimingAction;
  signalDate: string;
  nextTradingDay: {
    tradeDate: string;
    open: number;
    auctionVwap?: number | null;
    upLimit?: number | null;
    downLimit?: number | null;
  };
  exitBar: {
    tradeDate: string;
    close: number;
    high: number;
    low: number;
  };
  benchmarkReturnPct?: number;
};

export type TimingBacktestExecutionResult = {
  filled: boolean;
  blockedReason?: string;
  priceSource?: "AUCTION_VWAP" | "OPEN";
  fillPrice?: number;
  grossReturnPct?: number;
  netReturnPct?: number;
  excessReturnPct?: number;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
};

export function simulateTimingBacktestExecution(
  input: TimingBacktestExecutionInput,
  policy: TimingPresetConfigV2["backtestPolicy"],
): TimingBacktestExecutionResult {
  if (input.nextTradingDay.tradeDate <= input.signalDate) {
    return { filled: false, blockedReason: "成交日期必须晚于盘后信号日期。" };
  }
  const isBuy = ["PROBE", "ENTER", "ADD"].includes(input.action);
  const isSell = ["TRIM", "EXIT"].includes(input.action);
  if (!isBuy && !isSell) {
    return { filled: false, blockedReason: "观察或持有动作不模拟成交。" };
  }
  const rawPrice = input.nextTradingDay.auctionVwap ?? input.nextTradingDay.open;
  if (
    isBuy &&
    input.nextTradingDay.upLimit !== null &&
    input.nextTradingDay.upLimit !== undefined &&
    rawPrice >= input.nextTradingDay.upLimit
  ) {
    return { filled: false, blockedReason: "次日竞价达到涨停价，按无法买入处理。" };
  }
  if (
    isSell &&
    input.nextTradingDay.downLimit !== null &&
    input.nextTradingDay.downLimit !== undefined &&
    rawPrice <= input.nextTradingDay.downLimit
  ) {
    return { filled: false, blockedReason: "次日竞价达到跌停价，按无法卖出处理。" };
  }

  const slippage = policy.slippageBps / 10_000;
  const fillPrice = rawPrice * (isBuy ? 1 + slippage : 1 - slippage);
  const direction = isBuy ? 1 : -1;
  const grossReturnPct =
    ((input.exitBar.close - fillPrice) / Math.max(fillPrice, 0.0001)) *
    100 *
    direction;
  const tradingCostPct =
    (policy.commissionBps * 2 + policy.sellTaxBps) / 100;
  const netReturnPct = grossReturnPct - tradingCostPct;
  const favorablePrice = isBuy ? input.exitBar.high : input.exitBar.low;
  const adversePrice = isBuy ? input.exitBar.low : input.exitBar.high;
  const mfe =
    ((favorablePrice - fillPrice) / Math.max(fillPrice, 0.0001)) * 100 * direction;
  const mae =
    ((adversePrice - fillPrice) / Math.max(fillPrice, 0.0001)) * 100 * direction;

  return {
    filled: true,
    priceSource: input.nextTradingDay.auctionVwap ? "AUCTION_VWAP" : "OPEN",
    fillPrice: round(fillPrice),
    grossReturnPct: round(grossReturnPct),
    netReturnPct: round(netReturnPct),
    excessReturnPct: round(netReturnPct - (input.benchmarkReturnPct ?? 0)),
    maxFavorableExcursionPct: round(Math.max(mfe, mae)),
    maxAdverseExcursionPct: round(Math.min(mfe, mae)),
  };
}

export function summarizeTimingBacktestPerformance(
  results: TimingBacktestExecutionResult[],
): TimingBacktestPerformanceMetrics {
  const filled = results.filter(
    (item): item is Required<
      Pick<
        TimingBacktestExecutionResult,
        | "netReturnPct"
        | "excessReturnPct"
        | "maxFavorableExcursionPct"
        | "maxAdverseExcursionPct"
      >
    > &
      TimingBacktestExecutionResult => item.filled,
  );
  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  return {
    completedTrades: filled.length,
    hitRatePct: round(
      filled.length
        ? (filled.filter((item) => item.netReturnPct > 0).length /
            filled.length) *
            100
        : 0,
    ),
    averageReturnPct: round(average(filled.map((item) => item.netReturnPct))),
    averageExcessReturnPct: round(
      average(filled.map((item) => item.excessReturnPct)),
    ),
    maxFavorableExcursionPct: round(
      average(filled.map((item) => item.maxFavorableExcursionPct)),
    ),
    maxAdverseExcursionPct: round(
      average(filled.map((item) => item.maxAdverseExcursionPct)),
    ),
  };
}
