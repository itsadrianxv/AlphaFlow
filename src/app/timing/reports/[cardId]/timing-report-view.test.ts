import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TimingReportPanels,
  TimingReportView,
} from "~/app/timing/reports/[cardId]/timing-report-view";
import type { WorkflowDiagramRunDetail } from "~/app/workflows/workflow-diagram-runtime";
import type { TimingReportPayload } from "~/server/domain/timing/types";

const sampleReport = {
  card: {
    id: "card_1",
    workflowRunId: "run_timing_1",
    stockCode: "600519",
    stockName: "璐靛窞鑼呭彴",
    confidence: 83,
    actionBias: "ADD",
    summary:
      "Trend structure and relative strength both support a constructive stance.",
    riskFlags: ["HIGH_VOLATILITY"],
    signalSnapshot: {
      asOfDate: "2026-03-06",
      indicators: {
        close: 1680,
        macd: { dif: 12, dea: 8, histogram: 8 },
        rsi: { value: 64 },
        bollinger: {
          upper: 1700,
          middle: 1620,
          lower: 1540,
          closePosition: 0.78,
        },
        obv: { value: 12_000, slope: 450 },
        ema5: 1668,
        ema20: 1628,
        ema60: 1542,
        ema120: 1488,
        atr14: 32,
        volumeRatio20: 1.64,
        realizedVol20: 0.28,
        realizedVol120: 0.23,
        amount: 2_450_000_000,
        turnoverRate: 2.6,
      },
    },
    reasoning: {
      actionRationale:
        "The structure remains constructive and supports adding risk on confirmation.",
      signalContext: {
        summary: "Trend and relative strength remain supportive.",
        explanation: "Trend and relative strength remain supportive.",
        triggerNotes: ["Trend alignment remains intact."],
        invalidationNotes: ["A decisive loss of EMA20 would weaken the setup."],
      },
    },
  },
  bars: [
    {
      tradeDate: "2026-03-05",
      open: 1660,
      high: 1684,
      low: 1652,
      close: 1674,
      volume: 1800,
      amount: 3_013_200,
      turnoverRate: 2.1,
    },
    {
      tradeDate: "2026-03-06",
      open: 1676,
      high: 1692,
      low: 1668,
      close: 1680,
      volume: 2600,
      amount: 4_368_000,
      turnoverRate: 2.6,
    },
  ],
  chartLevels: {
    ema5: [
      { tradeDate: "2026-03-05", value: 1662 },
      { tradeDate: "2026-03-06", value: 1668 },
    ],
    ema20: [
      { tradeDate: "2026-03-05", value: 1618 },
      { tradeDate: "2026-03-06", value: 1628 },
    ],
    ema60: [
      { tradeDate: "2026-03-05", value: 1534 },
      { tradeDate: "2026-03-06", value: 1542 },
    ],
    ema120: [
      { tradeDate: "2026-03-05", value: 1480 },
      { tradeDate: "2026-03-06", value: 1488 },
    ],
    recentHigh60d: 1692,
    recentLow20d: 1604,
    avgVolume20: 1840,
    volumeSpikeDates: ["2026-03-06"],
  },
  evidence: {
    multiTimeframeAlignment: {
      key: "multiTimeframeAlignment",
      label: "澶氬懆鏈熶竴鑷存€?",
      direction: "bullish",
      score: 76,
      confidence: 0.84,
      weight: 0.24,
      detail: "EMA stack and medium-term returns remain supportive.",
      metrics: {
        bullishChecks: 6,
        bearishChecks: 1,
        return20d: 12.4,
      },
      warnings: [],
    },
    relativeStrength: {
      key: "relativeStrength",
      label: "鐩稿寮哄急",
      direction: "bullish",
      score: 66,
      confidence: 0.78,
      weight: 0.2,
      detail: "Relative returns remain positive against benchmark proxies.",
      metrics: {
        excess20d: 4.8,
        excess60d: 9.2,
        stockReturn20d: 12.4,
        stockReturn60d: 18.8,
        sampleSize: 24,
      },
      warnings: [],
    },
    volatilityPercentile: {
      key: "volatilityPercentile",
      label: "濞夈垹濮╅悳顖氼暔",
      direction: "neutral",
      score: 12,
      confidence: 0.52,
      weight: 0.14,
      detail: "Volatility remains manageable.",
      metrics: {
        volatilityPercentile: 46,
        atrPercentile: 48,
        atrRatio: 0.02,
      },
      warnings: ["HIGH_VOLATILITY"],
    },
    liquidityStructure: {
      key: "liquidityStructure",
      label: "娴佸姩鎬х粨鏋?",
      direction: "bullish",
      score: 58,
      confidence: 0.71,
      weight: 0.14,
      detail: "Turnover and amount percentiles remain healthy.",
      metrics: {
        volumeRatio20: 1.64,
        amountPercentile: 81,
        turnoverRate: 2.6,
        turnoverPercentile: 77,
      },
      warnings: [],
    },
    breakoutFailure: {
      key: "breakoutFailure",
      label: "绐佺牬鏈夋晥鎬?",
      direction: "bullish",
      score: 55,
      confidence: 0.69,
      weight: 0.14,
      detail: "Recent breakout failure rate remains low.",
      metrics: {
        failureRate: 18,
        distanceTo60dHighPct: -1.2,
      },
      warnings: [],
    },
    gapVolumeQuality: {
      key: "gapVolumeQuality",
      label: "缂哄彛涓庢斁閲忚川閲?",
      direction: "neutral",
      score: 16,
      confidence: 0.51,
      weight: 0.14,
      detail: "Recent gap activity is constructive but not decisive.",
      metrics: {
        recentGapCount: 2,
        latestVolumeRatio20: 1.64,
      },
      warnings: [],
    },
  },
  marketContext: {
    state: "RISK_ON",
    transition: "IMPROVING",
    regimeConfidence: 78,
    persistenceDays: 4,
    summary: "Market breadth and trend remain constructive.",
    constraints: ["Prioritize stronger names first."],
    breadthTrend: "EXPANDING",
    volatilityTrend: "FALLING",
    leadership: {
      leaderCode: "510300",
      leaderName: "CSI 300 ETF",
      switched: false,
      previousLeaderCode: null,
    },
    snapshot: {
      asOfDate: "2026-03-06",
      indexes: [],
      latestBreadth: {
        asOfDate: "2026-03-06",
        totalCount: 10,
        advancingCount: 6,
        decliningCount: 3,
        flatCount: 1,
        positiveRatio: 0.6,
        aboveThreePctRatio: 0.2,
        belowThreePctRatio: 0.1,
        medianChangePct: 0.8,
        averageTurnoverRate: 1.4,
      },
      latestVolatility: {
        asOfDate: "2026-03-06",
        highVolatilityCount: 1,
        highVolatilityRatio: 0.1,
        limitDownLikeCount: 0,
        indexAtrRatio: 0.02,
      },
      latestLeadership: {
        asOfDate: "2026-03-06",
        leaderCode: "510300",
        leaderName: "CSI 300 ETF",
        ranking5d: ["510300"],
        ranking10d: ["510300"],
        switched: false,
        previousLeaderCode: null,
      },
      breadthSeries: [],
      volatilitySeries: [],
      leadershipSeries: [],
      features: {
        benchmarkStrength: 72,
        breadthScore: 68,
        riskScore: 30,
        stateScore: 70,
      },
    },
    stateScore: 70,
  },
  reviewTimeline: [],
} as unknown as TimingReportPayload;

function createRun(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_timing_1",
    query: "600519",
    status: "SUCCEEDED",
    progressPercent: 100,
    currentNodeKey: "persist_cards",
    input: {},
    errorCode: null,
    errorMessage: null,
    result: {},
    template: {
      code: "timing_signal_pipeline_v1",
      version: 1,
    },
    createdAt: new Date("2026-03-06T08:00:00.000Z"),
    startedAt: new Date("2026-03-06T08:00:05.000Z"),
    completedAt: new Date("2026-03-06T08:02:00.000Z"),
    nodes: [
      {
        id: "node_1",
        nodeKey: "load_targets",
        agentName: "load_targets",
        attempt: 1,
        status: "SUCCEEDED",
        errorCode: null,
        errorMessage: null,
        durationMs: 500,
        startedAt: new Date("2026-03-06T08:00:05.000Z"),
        completedAt: new Date("2026-03-06T08:00:05.500Z"),
        output: {},
      },
    ],
    events: [],
    ...overrides,
  };
}

describe("TimingReportView", () => {
  it("renders five steps and defaults to agent when run data is present", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TimingReportView, {
        report: sampleReport,
        run: createRun(),
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="agent"');
    expect(markup).toContain("Agent 鐘舵€佸浘");
    expect(markup).toContain("褰撳墠缁撹");
    expect(markup).toContain("缁撴瀯璇佹嵁");
    expect(markup).toContain("鎵ц椋庢帶");
    expect(markup).toContain("澶嶇洏璺熻釜");
  });

  it("keeps the history preview on four steps and summary as the default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report: sampleReport,
        activeTabId: "summary",
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="summary"');
    expect(markup).not.toContain("Agent 鐘舵€佸浘");
    expect(markup).toContain("褰撳墠缁撹");
  });

  it("keeps the price chart and market context in the report steps", () => {
    const summaryMarkup = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report: sampleReport,
        activeTabId: "summary",
      }),
    );
    const executionMarkup = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report: sampleReport,
        activeTabId: "execution",
      }),
    );

    expect(summaryMarkup).toContain("浠锋牸缁撴瀯");
    expect(executionMarkup).toContain("甯傚満鐜");
    expect(executionMarkup).toContain("椋庨櫓鏍囩");
  });

  it("reuses the chart in the evidence step and hides the old structure explanation card", () => {
    const evidenceMarkup = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report: sampleReport,
        activeTabId: "evidence",
      }),
    );

    expect(evidenceMarkup).toContain("浠锋牸缁撴瀯");
    expect(evidenceMarkup).not.toContain("鏍稿績缁撴瀯");
  });

  it("renders translated evidence and risk labels without leaking raw english keys", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report: sampleReport,
        activeTabId: "evidence",
      }),
    );

    expect(markup).toContain("ATR");
    expect(markup).toContain("高波动");
    expect(markup).not.toContain("bullish");
    expect(markup).not.toContain("bearish");
    expect(markup).not.toContain("distanceTo60dHighPct");
    expect(markup).not.toContain("sampleSize");
  });
});
