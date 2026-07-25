import type { TimingDecisionInput } from "~/contracts/timing-decision";
import { buildSystemTimingTemplate } from "~/server/application/timing/system-timing-strategy-service";
import type {
  PortfolioPosition,
  PortfolioRiskPreferences,
  TimingPresetConfigV2,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import type { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

function collectIndicatorIds(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      config.ruleGroups.flatMap((group) =>
        group.rules
          .filter((rule) => rule.enabled)
          .map((rule) => rule.indicatorId),
      ),
    ),
  ];
}

function collectTimeframes(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      config.ruleGroups.flatMap((group) =>
        group.rules
          .filter((rule) => rule.enabled)
          .map((rule) => rule.timeframe),
      ),
    ),
  ] as TimingTimeframe[];
}

export class TimingDecisionService {
  constructor(
    private readonly deps: {
      portfolioRepository: PrismaPortfolioSnapshotRepository;
      revisionRepository: PrismaTimingPresetRevisionRepository;
      timingDataClient: PythonTimingDataClient;
    },
  ) {}

  async resolveConfig(userId: string, input: TimingDecisionInput) {
    if (input.strategySelection.kind === "SYSTEM") {
      const template = buildSystemTimingTemplate(input.strategySelection);
      return {
        config: template.config,
        revision: null,
        riskPreferences: input.riskPreferences ?? template.riskPreferences,
      };
    }
    const revision = await this.deps.revisionRepository.getRevision(
      userId,
      input.strategySelection.revisionId,
    );
    if (!revision || revision.status !== "PUBLISHED") {
      throw new Error("所选高级策略尚未发布。");
    }
    const defaults = buildSystemTimingTemplate({
      horizon: revision.config.timeframePlan.template,
      riskProfile: revision.config.riskProfile,
    });
    return {
      config: revision.config,
      revision,
      riskPreferences: input.riskPreferences ?? defaults.riskPreferences,
    };
  }

  buildPositions(input: TimingDecisionInput): PortfolioPosition[] {
    if (input.positionContext.mode === "SINGLE") {
      const target = input.targets[0];
      if (!input.positionContext.held || !target) return [];
      return [
        {
          ...target,
          quantity: 0,
          costBasis: input.positionContext.costBasis ?? 0,
          currentWeightPct: input.positionContext.currentWeightPct,
        },
      ];
    }
    return input.positionContext.positions.map((item) => ({
      ...item,
      quantity: item.quantity ?? 0,
      costBasis: item.costBasis ?? 0,
    }));
  }

  async createFrozenPortfolio(params: {
    userId: string;
    input: TimingDecisionInput;
    riskPreferences: PortfolioRiskPreferences;
  }) {
    return this.deps.portfolioRepository.create(
      this.buildFrozenPortfolioDraft(params),
    );
  }

  buildFrozenPortfolioDraft(params: {
    userId: string;
    input: TimingDecisionInput;
    riskPreferences: PortfolioRiskPreferences;
  }) {
    const context = params.input.positionContext;
    const single = context.mode === "SINGLE";
    const totalCapital = single ? 100 : context.totalCapital;
    const cash = single ? context.availableCashPct : context.cash;
    return {
      userId: params.userId,
      name: `择时分析 ${new Date().toLocaleDateString("zh-CN")}`,
      baseCurrency: single ? "PCT" : "CNY",
      cash,
      totalCapital,
      positions: this.buildPositions(params.input),
      riskPreferences: params.riskPreferences,
      source: "RUN_INPUT",
    } as const;
  }

  async preview(userId: string, input: TimingDecisionInput) {
    const resolved = await this.resolveConfig(userId, input);
    const targets = new Map(
      input.targets.map((item) => [item.stockCode, item]),
    );
    for (const position of this.buildPositions(input)) {
      targets.set(position.stockCode, position);
    }
    const response = await this.deps.timingDataClient.getEvidenceBatch({
      stockCodes: [...targets.keys()],
      asOfDate: input.analysisDate.asOfDate,
      timeframes: collectTimeframes(resolved.config),
      indicatorIds: collectIndicatorIds(resolved.config),
    });
    const primaryRules = resolved.config.ruleGroups
      .filter((group) => group.role === "PRIMARY")
      .flatMap((group) => group.rules.filter((rule) => rule.enabled));
    const vetoRules = resolved.config.ruleGroups
      .filter((group) => group.role === "VETO")
      .flatMap((group) => group.rules.filter((rule) => rule.enabled));
    const items = response.items.map((evidence) => {
      const available = (indicatorId: string, timeframe: TimingTimeframe) =>
        evidence.features.some(
          (feature) =>
            feature.indicatorId === indicatorId &&
            feature.timeframe === timeframe &&
            feature.status === "AVAILABLE",
        );
      const complete = primaryRules.every((rule) =>
        available(rule.indicatorId, rule.timeframe),
      );
      const riskResolved = vetoRules.every((rule) =>
        available(rule.indicatorId, rule.timeframe),
      );
      return {
        stockCode: evidence.stockCode,
        stockName: evidence.stockName,
        asOfDate: evidence.asOfDate,
        status: complete && riskResolved ? "READY" : "OBSERVE_ONLY",
        message:
          complete && riskResolved
            ? "数据齐全，可以生成动作建议。"
            : "部分数据尚未完整，本次只给出观察结论。",
      } as const;
    });
    const returned = new Set(items.map((item) => item.stockCode));
    const missing = [...targets.values()].filter(
      (item) => !returned.has(item.stockCode),
    );
    const readyCount = items.filter((item) => item.status === "READY").length;
    const observeOnlyCount = items.length - readyCount + missing.length;
    const complete = observeOnlyCount === 0 && response.errors.length === 0;
    return {
      totalCount: targets.size,
      readyCount,
      observeOnlyCount,
      complete,
      canRun: complete || input.analysisDate.mode === "CURRENT_PARTIAL",
      items,
      summary: complete
        ? `${readyCount} 只股票数据齐全，可以开始分析。`
        : `${readyCount} 只可生成建议，${observeOnlyCount} 只暂时只能观察。`,
    };
  }
}
