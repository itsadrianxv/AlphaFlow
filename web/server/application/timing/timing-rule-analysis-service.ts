import { evaluateTimingRules } from "~/server/domain/timing/services/timing-rule-engine";
import type {
  TimingCardDraft,
  TimingDecisionAudit,
  TimingEvidenceData,
  TimingMarketState,
  TimingPresetRevisionRecord,
  TimingSourceType,
} from "~/server/domain/timing/types";

const actionLabels = {
  WATCH: "观察",
  PROBE: "试仓",
  ENTER: "建仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
} as const;

const neutralIndicators = {
  close: 0,
  macd: { dif: 0, dea: 0, histogram: 0 },
  rsi: { value: 50 },
  bollinger: { upper: 0, middle: 0, lower: 0, closePosition: 0.5 },
  obv: { value: 0, slope: 0 },
  ema5: 0,
  ema20: 0,
  ema60: 0,
  ema120: 0,
  atr14: 0,
  volumeRatio20: 0,
  realizedVol20: 0,
  realizedVol120: 0,
};

const neutralSignalContext = {
  direction: "neutral" as const,
  compositeScore: 0,
  signalStrength: 0,
  confidence: 0,
  engineBreakdown: [],
  triggerNotes: [],
  invalidationNotes: [],
  riskFlags: [],
  explanation: "v2动作仅由确定性规则审计推导。",
  summary: "确定性规则审计",
};

function summarizeAudit(audit: TimingDecisionAudit) {
  const passed = audit.ruleEvaluations.filter((item) => item.status === "PASSED");
  const unavailable = audit.ruleEvaluations.filter((item) =>
    ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status),
  );
  const finalAction = audit.finalAction ? actionLabels[audit.finalAction] : "不产生动作";
  return `${audit.status}，${passed.length} 条规则通过，${unavailable.length} 条证据不可用于正式判断，最终动作：${finalAction}。`;
}

export class TimingRuleAnalysisService {
  buildCards(params: {
    userId: string;
    workflowRunId?: string;
    sourceType: TimingSourceType;
    sourceId: string;
    watchListId?: string;
    revision: TimingPresetRevisionRecord;
    evidence: TimingEvidenceData[];
    marketState: TimingMarketState;
    positionCodes?: Set<string>;
  }): TimingCardDraft[] {
    return params.evidence.map((item) => {
      const audit = evaluateTimingRules({
        config: params.revision.config,
        features: item.features,
        marketState: params.marketState,
        hasPosition: params.positionCodes?.has(item.stockCode) ?? false,
        strategyRevisionId: params.revision.id,
        configHash: params.revision.configHash,
      });
      const passed = audit.ruleEvaluations.filter((rule) => rule.status === "PASSED");
      const failedVetos = audit.ruleEvaluations.filter(
        (rule) => rule.role === "VETO" && rule.status === "PASSED",
      );
      const unavailable = audit.ruleEvaluations.filter((rule) =>
        ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(rule.status),
      );

      return {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        watchListId: params.watchListId,
        presetRevisionId: params.revision.id,
        stockCode: item.stockCode,
        stockName: item.stockName,
        asOfDate: item.asOfDate,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        actionBias: audit.finalAction ?? "WATCH",
        confidence: 0,
        marketState: params.marketState,
        summary: summarizeAudit(audit),
        triggerNotes: passed.map(
          (rule) => `${rule.ruleName}：实际值 ${String(rule.actual)}，阈值 ${String(rule.threshold)}`,
        ),
        invalidationNotes: [
          ...failedVetos.map((rule) => `${rule.ruleName}已触发：${rule.explanation}`),
          ...unavailable.map((rule) => `${rule.ruleName}证据${rule.status}，${rule.explanation}`),
        ],
        riskFlags: [],
        decisionStatus: audit.status,
        decisionAudit: audit,
        reasoning: {
          signalContext: neutralSignalContext,
          actionRationale: "动作由确定性规则、数据门控和市场门控推导。",
          indicators: neutralIndicators,
          decisionAudit: audit,
          dataManifest: item.dataManifest,
          featureEvidence: item.features,
          inputHash: item.inputHash,
        },
      };
    });
  }
}
