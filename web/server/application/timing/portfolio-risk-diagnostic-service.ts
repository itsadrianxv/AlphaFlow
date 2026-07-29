import type {
  PortfolioCompositionPosition,
  PortfolioRiskDiagnostic,
  TimingSignalData,
} from "~/server/domain/timing/types";

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function returns(values: number[]) {
  return values.slice(1).map((value, index) => value / Math.max(values[index] ?? value, 0.0001) - 1);
}

function covariance(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (length < 2) return null;
  const a = left.slice(-length);
  const b = right.slice(-length);
  const ma = mean(a);
  const mb = mean(b);
  return sum(a.map((value, index) => (value - ma) * ((b[index] ?? mb) - mb))) / (length - 1);
}

function correlation(left: number[], right: number[]) {
  const cov = covariance(left, right);
  const varLeft = covariance(left, left);
  const varRight = covariance(right, right);
  if (cov === null || !varLeft || !varRight) return null;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(varLeft * varRight)));
}

function aggregateExposure(
  positions: PortfolioCompositionPosition[],
  values: (position: PortfolioCompositionPosition) => string[],
) {
  const exposure = new Map<string, number>();
  for (const position of positions) {
    for (const value of values(position)) {
      if (!value) continue;
      exposure.set(value, (exposure.get(value) ?? 0) + position.weightPct);
    }
  }
  return [...exposure.entries()]
    .map(([name, weightPct]) => ({ name, weightPct: round(weightPct, 2) }))
    .sort((left, right) => right.weightPct - left.weightPct);
}

function correlationClusters(stockCodes: string[], matrix: Array<Array<number | null>>) {
  const visited = new Set<number>();
  const clusters: Array<{ stockCodes: string[]; averageCorrelation: number }> = [];
  for (let index = 0; index < stockCodes.length; index += 1) {
    if (visited.has(index)) continue;
    const members = new Set([index]);
    const queue = [index];
    while (queue.length) {
      const current = queue.shift();
      if (current === undefined) break;
      for (let candidate = 0; candidate < stockCodes.length; candidate += 1) {
        if (candidate === current || members.has(candidate)) continue;
        const value = matrix[current]?.[candidate];
        if (typeof value === "number" && value >= 0.7) {
          members.add(candidate);
          queue.push(candidate);
        }
      }
    }
    members.forEach((item) => visited.add(item));
    if (members.size < 2) continue;
    const indices = [...members];
    const pairs: number[] = [];
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        const value = matrix[indices[left] ?? 0]?.[indices[right] ?? 0];
        if (typeof value === "number") pairs.push(value);
      }
    }
    clusters.push({
      stockCodes: indices.map((item) => stockCodes[item] ?? "").filter(Boolean),
      averageCorrelation: round(mean(pairs)),
    });
  }
  return clusters;
}

export class PortfolioRiskDiagnosticService {
  build(params: {
    positions: PortfolioCompositionPosition[];
    signals: TimingSignalData[];
    asOfDate: string;
  }): PortfolioRiskDiagnostic {
    const sorted = [...params.positions].sort((left, right) => right.weightPct - left.weightPct);
    const weights = params.positions.map((item) => item.weightPct / 100);
    const hhi = sum(weights.map((weight) => weight ** 2));
    const signals = new Map(params.signals.map((item) => [item.stockCode, item]));
    const stockCodes = params.positions.map((item) => item.stockCode);
    const returnSeries = stockCodes.map((stockCode) => {
      const bars = signals.get(stockCode)?.barsByTimeframe?.DAILY ?? signals.get(stockCode)?.bars ?? [];
      return returns(bars.slice(-61).map((bar) => bar.close));
    });
    const matrix = stockCodes.map((_, left) =>
      stockCodes.map((__, right) => {
        if (left === right && returnSeries[left]?.length) return 1;
        const value = correlation(returnSeries[left] ?? [], returnSeries[right] ?? []);
        return value === null ? null : round(value);
      }),
    );

    const covarianceMatrix = stockCodes.map((_, left) =>
      stockCodes.map((__, right) => covariance(returnSeries[left] ?? [], returnSeries[right] ?? [])),
    );
    let portfolioVariance = 0;
    for (let left = 0; left < weights.length; left += 1) {
      for (let right = 0; right < weights.length; right += 1) {
        portfolioVariance += (weights[left] ?? 0) * (weights[right] ?? 0) * (covarianceMatrix[left]?.[right] ?? 0);
      }
    }
    const annualizedPct = portfolioVariance > 0 ? Math.sqrt(portfolioVariance * 252) * 100 : null;
    const rawContributions = weights.map((weight, index) => {
      const marginal = sum(weights.map((candidateWeight, candidate) => candidateWeight * (covarianceMatrix[index]?.[candidate] ?? 0)));
      return portfolioVariance > 0 ? (weight * marginal) / portfolioVariance : null;
    });

    const liquidityItems = params.positions.map((position) => {
      const bars = signals.get(position.stockCode)?.barsByTimeframe?.DAILY ?? signals.get(position.stockCode)?.bars ?? [];
      const recent = bars.slice(-20);
      return {
        stockCode: position.stockCode,
        averageAmount20: recent.some((bar) => typeof bar.amount === "number") ? mean(recent.flatMap((bar) => typeof bar.amount === "number" ? [bar.amount] : [])) : null,
        turnoverRate20: recent.some((bar) => typeof bar.turnoverRate === "number") ? mean(recent.flatMap((bar) => typeof bar.turnoverRate === "number" ? [bar.turnoverRate] : [])) : null,
      };
    });
    const amounts = liquidityItems.flatMap((item) => item.averageAmount20 === null ? [] : [item.averageAmount20]).sort((a, b) => a - b);
    const lowCut = amounts[Math.floor((amounts.length - 1) / 3)] ?? null;
    const highCut = amounts[Math.floor(((amounts.length - 1) * 2) / 3)] ?? null;
    const classified = liquidityItems.map((item) => ({
      ...item,
      level: item.averageAmount20 === null || lowCut === null || highCut === null
        ? "UNAVAILABLE" as const
        : item.averageAmount20 <= lowCut
          ? "LOW" as const
          : item.averageAmount20 >= highCut
            ? "HIGH" as const
            : "MEDIUM" as const,
    }));
    const buckets = (["HIGH", "MEDIUM", "LOW", "UNAVAILABLE"] as const).map((level) => ({
      level,
      weightPct: round(sum(classified.flatMap((item) => item.level === level ? [params.positions.find((position) => position.stockCode === item.stockCode)?.weightPct ?? 0] : [])), 2),
    }));
    const sectors = aggregateExposure(params.positions, (item) => [item.sector ?? "未分类"]);
    const themes = aggregateExposure(params.positions, (item) => item.themes.length ? item.themes : ["未分类"]);
    const largestSector = sectors[0];
    const topHolding = sorted[0];
    const completeStocks = returnSeries.filter((item) => item.length >= 40).length;
    const warnings: string[] = [];
    if (completeStocks < params.positions.length) warnings.push("部分标的不足 40 个重叠交易日，相关性与波动贡献已降级。 ");
    if (amounts.length < params.positions.length) warnings.push("部分标的缺少成交额，流动性分位不可用。 ");

    return {
      concentration: {
        top1Pct: round(sum(sorted.slice(0, 1).map((item) => item.weightPct)), 2),
        top3Pct: round(sum(sorted.slice(0, 3).map((item) => item.weightPct)), 2),
        top5Pct: round(sum(sorted.slice(0, 5).map((item) => item.weightPct)), 2),
        hhi: round(hhi),
        effectiveHoldings: hhi > 0 ? round(1 / hhi, 2) : 0,
      },
      exposures: { sectors, themes },
      correlation: { stockCodes, matrix, clusters: correlationClusters(stockCodes, matrix), lookbackDays: 60 },
      volatility: {
        annualizedPct: annualizedPct === null ? null : round(annualizedPct, 2),
        contributions: stockCodes.map((stockCode, index) => ({ stockCode, contributionPct: rawContributions[index] === null ? null : round((rawContributions[index] ?? 0) * 100, 2) })),
        lookbackDays: 60,
      },
      liquidity: { buckets, items: classified.map((item) => ({ ...item, averageAmount20: item.averageAmount20 === null ? null : round(item.averageAmount20, 2), turnoverRate20: item.turnoverRate20 === null ? null : round(item.turnoverRate20, 4) })) },
      scenarios: [
        { id: "MARKET_DOWN_5", name: "市场整体下跌 5%", estimatedImpactPct: -5, detail: "对全部成分应用相同的 5% 价格冲击。", disclaimer: "压力假设，不代表发生概率或投资建议。" },
        { id: "LARGEST_SECTOR_DOWN_8", name: "最大行业下跌 8%", estimatedImpactPct: largestSector ? round(-8 * largestSector.weightPct / 100, 2) : null, detail: largestSector ? `${largestSector.name} 暴露为 ${largestSector.weightPct}%。` : "缺少行业分类。", disclaimer: "压力假设，不代表发生概率或投资建议。" },
        { id: "TOP_HOLDING_DOWN_10", name: "最大权重标的下跌 10%", estimatedImpactPct: topHolding ? round(-10 * topHolding.weightPct / 100, 2) : null, detail: topHolding ? `${topHolding.stockName} 权重为 ${topHolding.weightPct}%。` : "缺少组合成分。", disclaimer: "压力假设，不代表发生概率或投资建议。" },
        { id: "VOLATILITY_UP_50", name: "波动率放大 1.5 倍", estimatedImpactPct: null, detail: annualizedPct === null ? "基础波动率不可用。" : `年化波动率由 ${round(annualizedPct, 2)}% 放大至 ${round(annualizedPct * 1.5, 2)}%。`, disclaimer: "压力假设，不代表发生概率或投资建议。" },
        { id: "LIQUIDITY_DOWN_50", name: "成交额收缩 50%", estimatedImpactPct: null, detail: `低流动性与数据缺失成分权重合计 ${round((buckets.find((item) => item.level === "LOW")?.weightPct ?? 0) + (buckets.find((item) => item.level === "UNAVAILABLE")?.weightPct ?? 0), 2)}%。`, disclaimer: "压力假设，不代表发生概率或投资建议。" },
      ],
      dataQuality: { asOfDate: params.asOfDate, completeStocks, totalStocks: params.positions.length, warnings },
    };
  }
}
