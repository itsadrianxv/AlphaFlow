import {
  createTimingPresetConfigV2,
  TIMING_RISK_PROFILE_DEFAULTS,
} from "~/server/domain/timing/strategy-v2";
import type {
  PortfolioRiskPreferences,
  TimingHorizonTemplate,
  TimingPresetConfigV2,
} from "~/server/domain/timing/types";
import type { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";

export const SYSTEM_TIMING_TEMPLATE_VERSION = 1;

const horizonLabels: Record<TimingHorizonTemplate, string> = {
  SHORT_SWING: "短波段",
  SWING: "波段",
  MEDIUM_TERM: "中期",
};

const profileLabels: Record<TimingPresetConfigV2["riskProfile"], string> = {
  STEADY: "稳健",
  BALANCED: "均衡",
  AGGRESSIVE: "进攻",
};

export function systemTimingTemplateKey(params: {
  horizon: TimingHorizonTemplate;
  riskProfile: TimingPresetConfigV2["riskProfile"];
}) {
  return `trend-continuation:${params.horizon}:${params.riskProfile}`;
}

export function buildSystemTimingTemplate(params: {
  horizon: TimingHorizonTemplate;
  riskProfile: TimingPresetConfigV2["riskProfile"];
}) {
  const name = `${profileLabels[params.riskProfile]}${horizonLabels[params.horizon]}`;
  return {
    key: systemTimingTemplateKey(params),
    name,
    description: `系统维护的${name}趋势延续策略。`,
    config: createTimingPresetConfigV2(
      "TREND_CONTINUATION",
      params.horizon,
      params.riskProfile,
    ),
    riskPreferences: {
      ...TIMING_RISK_PROFILE_DEFAULTS[params.riskProfile],
    } satisfies PortfolioRiskPreferences,
  };
}

export class SystemTimingStrategyService {
  constructor(
    private readonly repository: PrismaTimingPresetRevisionRepository,
  ) {}

  async resolve(params: {
    userId: string;
    horizon: TimingHorizonTemplate;
    riskProfile: TimingPresetConfigV2["riskProfile"];
  }) {
    const template = buildSystemTimingTemplate(params);
    const strategy = await this.repository.ensureSystemTemplate({
      userId: params.userId,
      templateKey: template.key,
      templateVersion: SYSTEM_TIMING_TEMPLATE_VERSION,
      name: template.name,
      description: template.description,
      config: template.config,
    });
    if (!strategy.activeRevision) {
      throw new Error("系统择时策略未能生成可运行版本。");
    }
    return {
      strategy,
      revision: strategy.activeRevision,
      riskPreferences: template.riskPreferences,
    };
  }
}
