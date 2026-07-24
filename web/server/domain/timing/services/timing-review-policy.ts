import type {
  TimingAction,
  TimingReviewCompletionDraft,
  TimingReviewRecord,
  TimingReviewVerdict,
} from "~/server/domain/timing/types";

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function pct(change: number, base: number) {
  return ((change - base) / Math.max(base, 0.0001)) * 100;
}

function isBullishAction(action: TimingAction) {
  return (
    action === "ENTER" ||
    action === "ADD" ||
    action === "PROBE" ||
    action === "HOLD"
  );
}

function buildVerdict(params: {
  expectedAction: TimingAction;
  actualReturnPct: number;
  maxAdverseExcursionPct: number;
}): TimingReviewVerdict {
  if (params.expectedAction === "WATCH") {
    if (Math.abs(params.actualReturnPct) <= 4) {
      return "SUCCESS";
    }

    return params.actualReturnPct > 8 ? "FAILURE" : "MIXED";
  }

  if (params.expectedAction === "TRIM" || params.expectedAction === "EXIT") {
    if (params.actualReturnPct <= -2) {
      return "SUCCESS";
    }

    return params.actualReturnPct >= 4 ? "FAILURE" : "MIXED";
  }

  if (isBullishAction(params.expectedAction)) {
    if (params.actualReturnPct >= 3 && params.maxAdverseExcursionPct >= -6) {
      return "SUCCESS";
    }

    return params.actualReturnPct <= -4 ? "FAILURE" : "MIXED";
  }

  return "MIXED";
}

function buildSummary(params: {
  stockName: string;
  reviewHorizon: TimingReviewRecord["reviewHorizon"];
  reviewTradingDays: number;
  expectedAction: TimingAction;
  actualReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  verdict: TimingReviewVerdict;
}) {
  const verdictText =
    params.verdict === "SUCCESS"
      ? "验证通过"
      : params.verdict === "FAILURE"
        ? "验证失败"
        : "表现一般";

  return `${params.stockName} 在 ${params.reviewTradingDays} 个交易日观察窗内 ${verdictText}，预期动作为 ${params.expectedAction}，区间收益 ${round(params.actualReturnPct)}%，最大顺行 ${round(params.maxFavorableExcursionPct)}%，最大逆行 ${round(params.maxAdverseExcursionPct)}%。`;
}

export class TimingReviewPolicy {
  evaluate(params: {
    reviewRecord: TimingReviewRecord;
    bars: Array<{ close: number; high: number; low: number }>;
    completedAt?: Date;
  }): TimingReviewCompletionDraft {
    if (params.bars.length === 0) {
      throw new Error(`缺少 ${params.reviewRecord.stockCode} 的复盘行情数据`);
    }

    const reviewBars = params.bars.slice(
      0,
      Math.max(2, params.reviewRecord.reviewTradingDays + 1),
    );
    const entry = reviewBars[0];
    if (!entry) {
      throw new Error(`缺少 ${params.reviewRecord.stockCode} 的复盘起点数据`);
    }

    const last = reviewBars[reviewBars.length - 1] ?? entry;
    const actualReturnPct = round(pct(last.close, entry.close));
    const maxFavorableExcursionPct = round(
      Math.max(...reviewBars.map((bar) => pct(bar.high, entry.close))),
    );
    const maxAdverseExcursionPct = round(
      Math.min(...reviewBars.map((bar) => pct(bar.low, entry.close))),
    );
    const verdict = buildVerdict({
      expectedAction: params.reviewRecord.expectedAction,
      actualReturnPct,
      maxAdverseExcursionPct,
    });

    return {
      id: params.reviewRecord.id,
      actualReturnPct,
      maxFavorableExcursionPct,
      maxAdverseExcursionPct,
      verdict,
      reviewSummary: buildSummary({
        stockName: params.reviewRecord.stockName,
        reviewHorizon: params.reviewRecord.reviewHorizon,
        reviewTradingDays: params.reviewRecord.reviewTradingDays,
        expectedAction: params.reviewRecord.expectedAction,
        actualReturnPct,
        maxFavorableExcursionPct,
        maxAdverseExcursionPct,
        verdict,
      }),
      completedAt: params.completedAt,
    };
  }
}
