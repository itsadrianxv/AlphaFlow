import { createTimingResearchRuleConfig } from "~/server/domain/timing/strategy-v2";
import type { TimingHorizonTemplate } from "~/server/domain/timing/types";
import type { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";

export const SYSTEM_TIMING_TEMPLATE_VERSION = 2;

const horizonLabels: Record<TimingHorizonTemplate, string> = {
  SHORT_SWING: "短波段",
  SWING: "波段",
  MEDIUM_TERM: "中期",
};

export function systemTimingTemplateKey(horizon: TimingHorizonTemplate) {
  return `trend-research:${horizon}`;
}

export function buildSystemTimingTemplate(horizon: TimingHorizonTemplate) {
  const name = `${horizonLabels[horizon]}趋势研究`;
  return {
    key: systemTimingTemplateKey(horizon),
    name,
    description: `系统维护的${name}规则集。`,
    config: createTimingResearchRuleConfig("TREND_CONTINUATION", horizon),
  };
}

export class SystemTimingStrategyService {
  constructor(private readonly repository: PrismaTimingPresetRevisionRepository) {}

  async resolve(params: { userId: string; horizon: TimingHorizonTemplate }) {
    const template = buildSystemTimingTemplate(params.horizon);
    const strategy = await this.repository.ensureSystemTemplate({
      userId: params.userId,
      templateKey: template.key,
      templateVersion: SYSTEM_TIMING_TEMPLATE_VERSION,
      name: template.name,
      description: template.description,
      config: template.config,
    });
    if (!strategy.activeRevision) throw new Error("系统研究规则未能生成可运行版本。");
    return { strategy, revision: strategy.activeRevision };
  }
}
