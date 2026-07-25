import { describe, expect, it, vi } from "vitest";

import { TimingDecisionService } from "~/server/application/timing/timing-decision-service";
import { buildSystemTimingTemplate } from "~/server/application/timing/system-timing-strategy-service";
import type { TimingDecisionInput } from "~/contracts/timing-decision";

describe("择时连续流程默认值", () => {
  it("生成九组周期与风格系统模板，并应用对应风险边界", () => {
    const horizons = ["SHORT_SWING", "SWING", "MEDIUM_TERM"] as const;
    const profiles = ["STEADY", "BALANCED", "AGGRESSIVE"] as const;
    const templates = horizons.flatMap((horizon) =>
      profiles.map((riskProfile) =>
        buildSystemTimingTemplate({ horizon, riskProfile }),
      ),
    );

    expect(new Set(templates.map((item) => item.key))).toHaveLength(9);
    expect(templates.every((item) => item.config.setup === "TREND_CONTINUATION")).toBe(true);
    expect(buildSystemTimingTemplate({ horizon: "SWING", riskProfile: "STEADY" }).riskPreferences).toEqual({
      maxSingleNamePct: 10,
      maxThemeExposurePct: 25,
      defaultProbePct: 2,
      maxPortfolioRiskBudgetPct: 15,
    });
    expect(buildSystemTimingTemplate({ horizon: "SWING", riskProfile: "AGGRESSIVE" }).riskPreferences).toEqual({
      maxSingleNamePct: 15,
      maxThemeExposurePct: 35,
      defaultProbePct: 5,
      maxPortfolioRiskBudgetPct: 30,
    });
  });

  it("单股输入冻结为100单位组合上下文", async () => {
    const create = vi.fn(async (value) => ({ id: "snapshot-1", ...value }));
    const service = new TimingDecisionService({
      portfolioRepository: { create } as never,
      revisionRepository: {} as never,
      timingDataClient: {} as never,
    });
    const input = {
      mode: "SINGLE",
      targets: [{ stockCode: "600519", stockName: "贵州茅台" }],
      positionContext: {
        mode: "SINGLE",
        held: true,
        currentWeightPct: 25,
        availableCashPct: 75,
      },
      strategySelection: {
        kind: "SYSTEM",
        horizon: "SWING",
        riskProfile: "BALANCED",
      },
      analysisDate: { mode: "LATEST_COMPLETE" },
    } satisfies TimingDecisionInput;

    await service.createFrozenPortfolio({
      userId: "user-1",
      input,
      riskPreferences: {
        maxSingleNamePct: 12,
        maxThemeExposurePct: 28,
        defaultProbePct: 3,
        maxPortfolioRiskBudgetPct: 20,
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        totalCapital: 100,
        cash: 75,
        baseCurrency: "PCT",
        source: "RUN_INPUT",
        positions: [expect.objectContaining({ stockCode: "600519", currentWeightPct: 25 })],
      }),
    );
  });
});
