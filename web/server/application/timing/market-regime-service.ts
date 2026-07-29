import type {
  MarketContextAnalysis,
  MarketContextSnapshot,
  MarketContextSnapshotRecord,
  TimingMarketBreadthTrend,
  TimingMarketState,
  TimingMarketTransition,
  TimingMarketVolatilityTrend,
} from "~/server/domain/timing/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function getBreadthTrend(
  snapshot: MarketContextSnapshot,
): TimingMarketBreadthTrend {
  const ratios = snapshot.breadthSeries
    .slice(-4)
    .map((item) => item.positiveRatio);
  if (ratios.length < 2) {
    return "STALLING";
  }

  const latestRatio = ratios.at(-1) ?? 0;
  const firstRatio = ratios[0] ?? 0;
  const delta = latestRatio - firstRatio;
  if (delta >= 0.08) {
    return "EXPANDING";
  }
  if (delta <= -0.08) {
    return "CONTRACTING";
  }
  return "STALLING";
}

function getVolatilityTrend(
  snapshot: MarketContextSnapshot,
): TimingMarketVolatilityTrend {
  const values = snapshot.volatilitySeries
    .slice(-4)
    .map((item) => item.highVolatilityRatio);
  if (values.length < 2) {
    return "STABLE";
  }

  const latestValue = values.at(-1) ?? 0;
  const firstValue = values[0] ?? 0;
  const delta = latestValue - firstValue;
  if (delta >= 0.05) {
    return "RISING";
  }
  if (delta <= -0.05) {
    return "FALLING";
  }
  return "STABLE";
}

export class MarketRegimeService {
  analyze(
    snapshot: MarketContextSnapshot,
    history: MarketContextSnapshotRecord[] = [],
  ): MarketContextAnalysis {
    const indexesAboveTrend = snapshot.indexes.filter(
      (item) => item.aboveEma20 && item.aboveEma60,
    ).length;
    const breadthPositive = snapshot.latestBreadth.positiveRatio;
    const highVolatilityRatio = snapshot.latestVolatility.highVolatilityRatio;
    const benchmarkStrength = snapshot.features.benchmarkStrength;
    const riskScore = snapshot.features.riskScore;
    const stateScore = snapshot.features.stateScore;
    const breadthTrend = getBreadthTrend(snapshot);
    const volatilityTrend = getVolatilityTrend(snapshot);

    const riskOffSignals = [
      breadthPositive < 0.42,
      highVolatilityRatio >= 0.28,
      benchmarkStrength < 45,
      indexesAboveTrend <= 1,
      riskScore >= 62,
      breadthTrend === "CONTRACTING",
      volatilityTrend === "RISING",
    ].filter(Boolean).length;

    const riskOnSignals = [
      breadthPositive >= 0.58,
      highVolatilityRatio <= 0.18,
      benchmarkStrength >= 60,
      indexesAboveTrend >= 2,
      riskScore <= 40,
      breadthTrend === "EXPANDING",
      volatilityTrend === "FALLING",
    ].filter(Boolean).length;

    let state: TimingMarketState = "NEUTRAL";
    if (riskOffSignals >= 4 || stateScore <= 38) {
      state = "RISK_OFF";
    } else if (riskOnSignals >= 4 || stateScore >= 62) {
      state = "RISK_ON";
    }

    const recentScores = snapshot.breadthSeries.slice(-5).map((item, index) => {
      const volatility = snapshot.volatilitySeries[index];
      if (!volatility) {
        return 50;
      }
      return (
        (item.positiveRatio * 55 +
          (1 - volatility.highVolatilityRatio) * 25 +
          (snapshot.indexes.filter((value) => value.aboveEma20).length /
            Math.max(snapshot.indexes.length, 1)) *
            20) *
        100
      );
    });
    const scoreSlope =
      recentScores.length >= 2
        ? (recentScores.at(-1) ?? 0) - (recentScores[0] ?? 0)
        : 0;
    const previousState = history[0]?.state;
    let transition: TimingMarketTransition = "STABLE";
    if (
      previousState &&
      previousState !== state &&
      state === "RISK_ON" &&
      scoreSlope > 6
    ) {
      transition = "PIVOT_UP";
    } else if (
      previousState &&
      previousState !== state &&
      state === "RISK_OFF" &&
      scoreSlope < -6
    ) {
      transition = "PIVOT_DOWN";
    } else if (scoreSlope >= 6 || breadthTrend === "EXPANDING") {
      transition = "IMPROVING";
    } else if (scoreSlope <= -6 || breadthTrend === "CONTRACTING") {
      transition = "DETERIORATING";
    }

    let persistenceDays = 1;
    for (const record of history) {
      if (record.state !== state) {
        break;
      }
      persistenceDays += 1;
    }

    const regimeConfidence = clamp(
      round(
        52 +
          Math.abs(riskOnSignals - riskOffSignals) * 7 +
          Math.abs(stateScore - 50) * 0.35 +
          average([Math.abs(scoreSlope), persistenceDays]) * 0.4,
      ),
      45,
      95,
    );

    const latestLeadership = snapshot.latestLeadership;
    const constraints =
      state === "RISK_OFF"
        ? [
            "市场广度收缩，个股技术结构的持续性更容易受到扰动。",
            "波动扩张会降低短周期信号的稳定性。",
            "需要单独核对相对强弱与流动性证据是否同步恶化。",
          ]
        : state === "RISK_ON"
          ? [
              "市场广度与基准趋势相对积极，但不代表任一个股技术结构成立。",
              "领涨结构和相对强弱可用于解释市场内部差异。",
            ]
          : [
              "市场内部证据分化，广度和波动尚未形成一致方向。",
              "环境状态仅用于解释个股研究背景，不参与个股状态判定。",
            ];

    const summary =
      state === "RISK_OFF"
        ? `市场处于防守态，breadth ${round(breadthPositive * 100)}%，波动趋势 ${volatilityTrend.toLowerCase()}。`
        : state === "RISK_ON"
          ? `市场处于偏进攻态，breadth ${round(breadthPositive * 100)}%，领涨代理为 ${latestLeadership.leaderCode}。`
          : `市场仍偏中性，transition ${transition.toLowerCase()}，需要继续观察 breadth 与波动方向。`;

    return {
      state,
      transition,
      regimeConfidence,
      persistenceDays,
      summary,
      constraints,
      breadthTrend,
      volatilityTrend,
      leadership: {
        leaderCode: latestLeadership.leaderCode,
        leaderName: latestLeadership.leaderName,
        switched: latestLeadership.switched,
        previousLeaderCode: latestLeadership.previousLeaderCode,
      },
      snapshot,
      stateScore: round(stateScore),
    };
  }
}
