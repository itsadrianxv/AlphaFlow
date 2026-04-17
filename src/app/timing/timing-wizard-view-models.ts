import {
  DEFAULT_TIMING_PRESET_CONFIG,
  resolveTimingPresetConfig,
} from "~/server/domain/timing/preset";
import type {
  TimingPresetConfig,
  TimingRecommendationReasoning,
} from "~/server/domain/timing/types";

export type TimingStrategyStyleKey = "steady" | "balanced" | "aggressive";

export type StockSelection = {
  stockCode: string;
  stockName: string;
  market?: string;
};

export type PortfolioPositionDraft = {
  clientId: string;
  stockCode: string;
  stockName: string;
  market: string;
  quantity: string;
  costBasis: string;
  currentWeightPct: string;
  sector: string;
  themes: string;
  openedAt: string;
  lastAddedAt: string;
  invalidationPrice: string;
  plannedHoldingDays: string;
  advancedOpen: boolean;
};

export type PortfolioFormValues = {
  name: string;
  baseCurrency: string;
  cash: string;
  totalCapital: string;
  maxSingleNamePct: string;
  maxThemeExposurePct: string;
  defaultProbePct: string;
  maxPortfolioRiskBudgetPct: string;
  positions: PortfolioPositionDraft[];
};

export type PortfolioFormErrors = {
  name?: string;
  cash?: string;
  totalCapital?: string;
  maxSingleNamePct?: string;
  maxThemeExposurePct?: string;
  defaultProbePct?: string;
  maxPortfolioRiskBudgetPct?: string;
  rows: Record<
    string,
    Partial<
      Record<
        | "stockCode"
        | "quantity"
        | "costBasis"
        | "currentWeightPct"
        | "openedAt"
        | "lastAddedAt"
        | "invalidationPrice"
        | "plannedHoldingDays",
        string
      >
    >
  >;
};

export type PortfolioPayload = {
  name: string;
  baseCurrency: string;
  cash: number;
  totalCapital: number;
  positions: Array<{
    stockCode: string;
    stockName: string;
    quantity: number;
    costBasis: number;
    currentWeightPct: number;
    sector?: string;
    themes?: string[];
    openedAt?: string;
    lastAddedAt?: string;
    invalidationPrice?: number;
    plannedHoldingDays?: number;
  }>;
  riskPreferences: {
    maxSingleNamePct: number;
    maxThemeExposurePct: number;
    defaultProbePct: number;
    maxPortfolioRiskBudgetPct: number;
  };
};

export type RiskSummary = {
  availableCashPct: number | null;
  maxSingleNamePct: number | null;
  defaultProbePct: number | null;
  maxPortfolioRiskBudgetPct: number | null;
  crowdedExposures: string[];
  blockedActions: string[];
  notes: string[];
};

export const strategyStyleCards: Array<{
  key: TimingStrategyStyleKey;
  title: string;
  summary: string;
  detail: string;
}> = [
  {
    key: "steady",
    title: "稳健",
    summary: "更重视确认与回撤控制。",
    detail: "提高加仓门槛，复盘周期偏长，更适合防守或新资金谨慎入场。",
  },
  {
    key: "balanced",
    title: "均衡",
    summary: "在确认和灵活之间取平衡。",
    detail: "保持默认节奏，既不过度追涨，也不过早错过趋势。",
  },
  {
    key: "aggressive",
    title: "进攻",
    summary: "更快响应信号变化。",
    detail: "降低试仓与加仓门槛，复盘更频繁，适合主动跟踪节奏。",
  },
];

function createDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `draft-${Math.random().toString(16).slice(2)}`;
}

function parseNumber(value: string | number) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function clonePresetConfig(config?: TimingPresetConfig | null) {
  return JSON.parse(
    JSON.stringify(resolveTimingPresetConfig(config)),
  ) as TimingPresetConfig;
}

export function createEmptyPortfolioPositionDraft(
  stock?: StockSelection,
): PortfolioPositionDraft {
  return {
    clientId: createDraftId(),
    stockCode: stock?.stockCode ?? "",
    stockName: stock?.stockName ?? "",
    market: stock?.market ?? "",
    quantity: "",
    costBasis: "",
    currentWeightPct: "",
    sector: "",
    themes: "",
    openedAt: "",
    lastAddedAt: "",
    invalidationPrice: "",
    plannedHoldingDays: "",
    advancedOpen: false,
  };
}

export function buildPortfolioPositionDraft(
  position: NonNullable<PortfolioPayload["positions"]>[number],
): PortfolioPositionDraft {
  return {
    clientId: createDraftId(),
    stockCode: position.stockCode,
    stockName: position.stockName,
    market: "",
    quantity: String(position.quantity),
    costBasis: String(position.costBasis),
    currentWeightPct: String(position.currentWeightPct),
    sector: position.sector ?? "",
    themes: position.themes?.join(", ") ?? "",
    openedAt: position.openedAt ?? "",
    lastAddedAt: position.lastAddedAt ?? "",
    invalidationPrice:
      position.invalidationPrice === undefined
        ? ""
        : String(position.invalidationPrice),
    plannedHoldingDays:
      position.plannedHoldingDays === undefined
        ? ""
        : String(position.plannedHoldingDays),
    advancedOpen: false,
  };
}

export function createPresetConfigForStyle(style: TimingStrategyStyleKey) {
  const config = clonePresetConfig(DEFAULT_TIMING_PRESET_CONFIG);

  switch (style) {
    case "steady":
      config.feedbackPolicy = {
        ...config.feedbackPolicy,
        lookbackDays: 240,
        minimumSamples: 16,
      };
      config.actionThresholds = {
        ...config.actionThresholds,
        addConfidence: 78,
        addSignalStrength: 72,
        probeConfidence: 60,
        probeSignalStrength: 56,
        holdConfidence: 64,
        trimConfidence: 66,
        exitConfidence: 80,
      };
      config.reviewSchedule = {
        horizons: ["T10", "T20"],
      };
      break;
    case "aggressive":
      config.contextWeights = {
        ...config.contextWeights,
        signalContext: 1.1,
        marketContext: 0.75,
      };
      config.feedbackPolicy = {
        ...config.feedbackPolicy,
        lookbackDays: 120,
        minimumSamples: 8,
      };
      config.actionThresholds = {
        ...config.actionThresholds,
        addConfidence: 70,
        addSignalStrength: 64,
        probeConfidence: 50,
        probeSignalStrength: 46,
        holdConfidence: 56,
        trimConfidence: 72,
        exitConfidence: 84,
      };
      config.reviewSchedule = {
        horizons: ["T5", "T10"],
      };
      break;
    case "balanced":
      break;
  }

  return config;
}

export function inferStrategyStyleKey(params: {
  name?: string | null;
  description?: string | null;
  config?: TimingPresetConfig | null;
}): TimingStrategyStyleKey {
  const haystack = `${params.name ?? ""} ${params.description ?? ""}`;
  if (/(稳健|防守|保守)/.test(haystack)) {
    return "steady";
  }
  if (/(进攻|激进|积极)/.test(haystack)) {
    return "aggressive";
  }
  if (/(均衡|平衡)/.test(haystack)) {
    return "balanced";
  }

  const config = resolveTimingPresetConfig(params.config);
  const addConfidence = config.actionThresholds?.addConfidence ?? 74;
  const probeConfidence = config.actionThresholds?.probeConfidence ?? 56;
  const horizons = config.reviewSchedule?.horizons ?? [];

  if (
    addConfidence >= 78 &&
    probeConfidence >= 60 &&
    !horizons.includes("T5")
  ) {
    return "steady";
  }

  if (
    addConfidence <= 72 ||
    probeConfidence <= 54 ||
    (horizons.includes("T5") && !horizons.includes("T20"))
  ) {
    return "aggressive";
  }

  return "balanced";
}

export function parsePortfolioForm(values: PortfolioFormValues):
  | {
      ok: true;
      payload: PortfolioPayload;
    }
  | {
      ok: false;
      errors: PortfolioFormErrors;
    } {
  const errors: PortfolioFormErrors = { rows: {} };
  const name = values.name.trim();
  if (!name) {
    errors.name = "请输入组合名称。";
  }

  const cash = parseNumber(values.cash);
  if (cash === null || cash < 0) {
    errors.cash = "请输入有效的现金金额。";
  }

  const totalCapital = parseNumber(values.totalCapital);
  if (totalCapital === null || totalCapital <= 0) {
    errors.totalCapital = "请输入大于 0 的总资产。";
  }

  if (
    cash !== null &&
    totalCapital !== null &&
    totalCapital > 0 &&
    cash > totalCapital
  ) {
    errors.totalCapital = "总资产必须大于或等于现金。";
  }

  const maxSingleNamePct = parseNumber(values.maxSingleNamePct);
  if (
    maxSingleNamePct === null ||
    maxSingleNamePct <= 0 ||
    maxSingleNamePct > 100
  ) {
    errors.maxSingleNamePct = "单票上限需在 0 到 100 之间。";
  }

  const maxThemeExposurePct = parseNumber(values.maxThemeExposurePct);
  if (
    maxThemeExposurePct === null ||
    maxThemeExposurePct <= 0 ||
    maxThemeExposurePct > 100
  ) {
    errors.maxThemeExposurePct = "主题暴露需在 0 到 100 之间。";
  }

  const defaultProbePct = parseNumber(values.defaultProbePct);
  if (
    defaultProbePct === null ||
    defaultProbePct <= 0 ||
    defaultProbePct > 100
  ) {
    errors.defaultProbePct = "试仓比例需在 0 到 100 之间。";
  }

  const maxPortfolioRiskBudgetPct = parseNumber(
    values.maxPortfolioRiskBudgetPct,
  );
  if (
    maxPortfolioRiskBudgetPct === null ||
    maxPortfolioRiskBudgetPct <= 0 ||
    maxPortfolioRiskBudgetPct > 100
  ) {
    errors.maxPortfolioRiskBudgetPct = "风险预算需在 0 到 100 之间。";
  }

  const positions = values.positions.flatMap((position) => {
    const rowErrors: PortfolioFormErrors["rows"][string] = {};
    const hasAnyValue =
      position.stockCode.trim() ||
      position.stockName.trim() ||
      position.quantity.trim() ||
      position.costBasis.trim() ||
      position.currentWeightPct.trim() ||
      position.sector.trim() ||
      position.themes.trim() ||
      position.openedAt.trim() ||
      position.lastAddedAt.trim() ||
      position.invalidationPrice.trim() ||
      position.plannedHoldingDays.trim();

    if (!hasAnyValue) {
      return [];
    }

    if (!/^\d{6}$/.test(position.stockCode.trim())) {
      rowErrors.stockCode = "请选择一只股票。";
    }

    const quantity = parseNumber(position.quantity);
    if (quantity === null || quantity < 0) {
      rowErrors.quantity = "请输入有效的持仓数量。";
    }

    const costBasis = parseNumber(position.costBasis);
    if (costBasis === null || costBasis < 0) {
      rowErrors.costBasis = "请输入有效的成本价。";
    }

    const currentWeightPct = parseNumber(position.currentWeightPct);
    if (
      currentWeightPct === null ||
      currentWeightPct < 0 ||
      currentWeightPct > 100
    ) {
      rowErrors.currentWeightPct = "当前仓位需在 0 到 100 之间。";
    }

    if (
      position.openedAt.trim() &&
      !/^\d{4}-\d{2}-\d{2}$/.test(position.openedAt.trim())
    ) {
      rowErrors.openedAt = "建仓日期格式需为 YYYY-MM-DD。";
    }

    if (
      position.lastAddedAt.trim() &&
      !/^\d{4}-\d{2}-\d{2}$/.test(position.lastAddedAt.trim())
    ) {
      rowErrors.lastAddedAt = "最近加仓日期格式需为 YYYY-MM-DD。";
    }

    const invalidationPrice = position.invalidationPrice.trim()
      ? parseNumber(position.invalidationPrice)
      : null;
    if (
      position.invalidationPrice.trim() &&
      (invalidationPrice === null || invalidationPrice <= 0)
    ) {
      rowErrors.invalidationPrice = "失效价需要大于 0。";
    }

    const plannedHoldingDays = position.plannedHoldingDays.trim()
      ? parseNumber(position.plannedHoldingDays)
      : null;
    if (
      position.plannedHoldingDays.trim() &&
      (plannedHoldingDays === null ||
        plannedHoldingDays <= 0 ||
        !Number.isInteger(plannedHoldingDays))
    ) {
      rowErrors.plannedHoldingDays = "计划持有天数需要是正整数。";
    }

    if (Object.keys(rowErrors).length > 0) {
      errors.rows[position.clientId] = rowErrors;
      return [];
    }

    return [
      {
        stockCode: position.stockCode.trim(),
        stockName: position.stockName.trim(),
        quantity: quantity ?? 0,
        costBasis: costBasis ?? 0,
        currentWeightPct: currentWeightPct ?? 0,
        sector: position.sector.trim() || undefined,
        themes:
          position.themes
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean) || undefined,
        openedAt: position.openedAt.trim() || undefined,
        lastAddedAt: position.lastAddedAt.trim() || undefined,
        invalidationPrice: invalidationPrice ?? undefined,
        plannedHoldingDays: plannedHoldingDays ?? undefined,
      },
    ];
  });

  const hasErrors =
    Object.keys(errors).some(
      (key) =>
        key !== "rows" &&
        errors[key as keyof Omit<PortfolioFormErrors, "rows">],
    ) || Object.keys(errors.rows).length > 0;
  if (
    hasErrors ||
    cash === null ||
    totalCapital === null ||
    maxSingleNamePct === null ||
    maxThemeExposurePct === null ||
    defaultProbePct === null ||
    maxPortfolioRiskBudgetPct === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      name,
      baseCurrency: values.baseCurrency.trim() || "CNY",
      cash,
      totalCapital,
      positions,
      riskPreferences: {
        maxSingleNamePct,
        maxThemeExposurePct,
        defaultProbePct,
        maxPortfolioRiskBudgetPct,
      },
    },
  };
}

export function buildRiskSummary(params: {
  cash: string | number;
  totalCapital: string | number;
  maxSingleNamePct: string | number;
  maxThemeExposurePct: string | number;
  defaultProbePct: string | number;
  maxPortfolioRiskBudgetPct: string | number;
  positions: Array<{
    currentWeightPct: string | number;
    sector?: string;
    themes?: string | string[];
  }>;
  reasoning?: TimingRecommendationReasoning | null;
}): RiskSummary {
  const cash = parseNumber(params.cash);
  const totalCapital = parseNumber(params.totalCapital);
  const riskPlan = params.reasoning?.riskPlan;
  const exposureMap = new Map<string, number>();
  for (const position of params.positions) {
    const weight = parseNumber(position.currentWeightPct) ?? 0;
    const themes =
      typeof position.themes === "string"
        ? position.themes
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : (position.themes?.filter(Boolean) ?? []);
    const buckets =
      themes.length > 0 ? themes : position.sector ? [position.sector] : [];
    for (const bucket of buckets) {
      exposureMap.set(bucket, (exposureMap.get(bucket) ?? 0) + weight);
    }
  }

  const maxThemeExposurePct = parseNumber(params.maxThemeExposurePct);
  const crowdedExposures = [...exposureMap.entries()]
    .filter(([, exposure]) =>
      maxThemeExposurePct === null
        ? exposure >= 20
        : exposure >= maxThemeExposurePct,
    )
    .map(
      ([theme, exposure]) => `${theme} 当前暴露约 ${exposure.toFixed(2)}%。`,
    );

  return {
    availableCashPct:
      cash === null || totalCapital === null || totalCapital <= 0
        ? null
        : Math.round((cash / totalCapital) * 10_000) / 100,
    maxSingleNamePct:
      riskPlan?.maxSingleNamePct ?? parseNumber(params.maxSingleNamePct),
    defaultProbePct:
      riskPlan?.defaultProbePct ?? parseNumber(params.defaultProbePct),
    maxPortfolioRiskBudgetPct:
      riskPlan?.portfolioRiskBudgetPct ??
      parseNumber(params.maxPortfolioRiskBudgetPct),
    crowdedExposures,
    blockedActions: riskPlan?.blockedActions ?? [],
    notes: riskPlan?.notes ?? [],
  };
}
