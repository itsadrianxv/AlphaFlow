import { randomUUID } from "node:crypto";
import type { TimingResearchRunInput } from "~/contracts/timing-research";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { PortfolioRiskDiagnosticService } from "~/server/application/timing/portfolio-risk-diagnostic-service";
import { SystemTimingStrategyService } from "~/server/application/timing/system-timing-strategy-service";
import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { evaluateTimingResearchRules } from "~/server/domain/timing/services/timing-rule-engine";
import type {
  PortfolioCompositionPosition,
  TimingResearchReportDraft,
  TimingResearchRuleConfig,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { PrismaPortfolioCompositionRepository } from "~/server/infrastructure/timing/prisma-portfolio-composition-repository";
import type { PrismaPortfolioRiskDiagnosticRepository } from "~/server/infrastructure/timing/prisma-portfolio-risk-diagnostic-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
import type { PrismaTimingResearchReportRepository } from "~/server/infrastructure/timing/prisma-timing-research-report-repository";
import type { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

function collectIndicatorIds(config: TimingResearchRuleConfig) {
  return [...new Set(config.ruleGroups.flatMap((group) => group.rules.filter((rule) => rule.enabled).map((rule) => rule.indicatorId)))];
}

function collectTimeframes(config: TimingResearchRuleConfig) {
  return [...new Set(config.ruleGroups.flatMap((group) => group.rules.filter((rule) => rule.enabled).map((rule) => rule.timeframe)))] as TimingTimeframe[];
}

export class TimingResearchRunService {
  constructor(private readonly deps: {
    revisionRepository: PrismaTimingPresetRevisionRepository;
    signalSnapshotRepository: PrismaTimingSignalSnapshotRepository;
    researchReportRepository: PrismaTimingResearchReportRepository;
    compositionRepository: PrismaPortfolioCompositionRepository;
    diagnosticRepository: PrismaPortfolioRiskDiagnosticRepository;
    marketContextRepository: PrismaTimingMarketContextSnapshotRepository;
    timingDataClient: PythonTimingDataClient;
  }) {}

  private async resolveRevision(userId: string, input: TimingResearchRunInput) {
    if (input.strategySelection.kind === "SYSTEM") {
      return (await new SystemTimingStrategyService(this.deps.revisionRepository).resolve({ userId, horizon: input.strategySelection.horizon })).revision;
    }
    const revision = await this.deps.revisionRepository.getRevision(userId, input.strategySelection.revisionId);
    if (!revision || revision.status !== "PUBLISHED") throw new Error("所选研究规则修订尚未发布。");
    return revision;
  }

  async preview(userId: string, input: TimingResearchRunInput) {
    const revision = await this.resolveRevision(userId, input);
    const targets = this.targets(input);
    const evidence = await this.deps.timingDataClient.getEvidenceBatch({
      stockCodes: targets.map((item) => item.stockCode),
      asOfDate: input.analysisDate.asOfDate,
      timeframes: collectTimeframes(revision.config),
      indicatorIds: collectIndicatorIds(revision.config),
    });
    const requiredRules = revision.config.ruleGroups.flatMap((group) => group.rules.filter((rule) => rule.enabled && rule.required));
    const items = evidence.items.map((item) => {
      const available = new Set(item.features.filter((feature) => feature.status === "AVAILABLE").map((feature) => `${feature.indicatorId}:${feature.timeframe}`));
      const missing = requiredRules.filter((rule) => !available.has(`${rule.indicatorId}:${rule.timeframe}`)).map((rule) => rule.name);
      return { stockCode: item.stockCode, stockName: item.stockName, asOfDate: item.asOfDate, status: missing.length ? "DATA_INCOMPLETE" as const : "READY" as const, missing };
    });
    return {
      totalCount: targets.length,
      readyCount: items.filter((item) => item.status === "READY").length,
      incompleteCount: targets.length - items.filter((item) => item.status === "READY").length,
      canRun: items.length > 0,
      items,
      errors: evidence.errors,
      configHash: revision.configHash,
    };
  }

  async run(userId: string, input: TimingResearchRunInput) {
    const revision = await this.resolveRevision(userId, input);
    const targets = this.targets(input);
    const sourceId = input.sourceWatchListId ?? randomUUID();
    const stockCodes = targets.map((item) => item.stockCode);
    const [signalsResult, evidenceResult, marketSnapshot] = await Promise.all([
      this.deps.timingDataClient.getSignalsBatch({ stockCodes, asOfDate: input.analysisDate.asOfDate, includeBars: true }),
      this.deps.timingDataClient.getEvidenceBatch({ stockCodes, asOfDate: input.analysisDate.asOfDate, timeframes: collectTimeframes(revision.config), indicatorIds: collectIndicatorIds(revision.config) }),
      this.deps.timingDataClient.getMarketContext({ asOfDate: input.analysisDate.asOfDate }),
    ]);
    const history = await this.deps.marketContextRepository.listRecent(20);
    const marketContext = new MarketRegimeService().analyze(marketSnapshot, history.filter((item) => item.asOfDate !== marketSnapshot.asOfDate));
    await this.deps.marketContextRepository.upsert({ asOfDate: marketSnapshot.asOfDate, snapshot: marketSnapshot, analysis: marketContext });
    const snapshots = await this.deps.signalSnapshotRepository.createResearchSnapshots({
      userId,
      sourceType: input.sourceWatchListId ? "watchlist" : "single",
      sourceId,
      presetRevisionId: revision.id,
      signals: signalsResult.items,
      evidence: evidenceResult.items,
    });
    const snapshotByCode = new Map(snapshots.map((item) => [item.stockCode, item]));
    const assessments = new TimingAnalysisService().buildTechnicalAssessments(signalsResult.items);
    const assessmentByCode = new Map(assessments.map((item) => [item.stockCode, item]));
    const signalByCode = new Map(signalsResult.items.map((item) => [item.stockCode, item]));
    const reports: TimingResearchReportDraft[] = evidenceResult.items.flatMap((evidence) => {
      const assessment = assessmentByCode.get(evidence.stockCode);
      const snapshot = snapshotByCode.get(evidence.stockCode);
      const signal = signalByCode.get(evidence.stockCode);
      if (!assessment || !snapshot || !signal) return [];
      const ruleAudit = evaluateTimingResearchRules({ config: revision.config, features: evidence.features, strategyRevisionId: revision.id, configHash: revision.configHash });
      const available = evidence.features.filter((item) => item.status === "AVAILABLE").length;
      const missing = evidence.features.filter((item) => item.status !== "AVAILABLE").map((item) => `${item.indicatorId}:${item.timeframe}`);
      return [{
        userId,
        watchListId: input.sourceWatchListId,
        presetId: revision.presetId,
        presetRevisionId: revision.id,
        stockCode: evidence.stockCode,
        stockName: evidence.stockName,
        asOfDate: evidence.asOfDate,
        sourceType: input.sourceWatchListId ? "watchlist" : "single",
        sourceId,
        signalSnapshotId: snapshot.id,
        researchState: ruleAudit.researchState,
        trendState: assessment.trendState,
        confidence: assessment.confidence,
        marketState: marketContext.state,
        marketTransition: marketContext.transition,
        summary: `${assessment.summary} 规则研究状态为 ${ruleAudit.researchState}。`,
        dimensions: assessment.dimensions,
        observationConditions: assessment.observationConditions,
        dataCompleteness: { status: missing.length ? (available ? "PARTIAL" : "INSUFFICIENT") : "COMPLETE", available, total: evidence.features.length, missing, warnings: evidence.warnings },
        modelOutlook: null,
        riskFlags: assessment.riskFlags,
        reasoning: { indicators: signal.indicators, engineBreakdown: assessment.engineBreakdown, dataManifest: evidence.dataManifest, featureEvidence: evidence.features, inputHash: evidence.inputHash },
        ruleAudit,
      }];
    });
    const persistedReports = await this.deps.researchReportRepository.createMany(reports);
    let portfolioDiagnostic = null;
    if (input.mode === "PORTFOLIO" && input.portfolioComposition) {
      const composition = await this.deps.compositionRepository.create({ userId, name: input.portfolioComposition.name, positions: input.portfolioComposition.positions as PortfolioCompositionPosition[], source: "RUN_INPUT" });
      const diagnostic = new PortfolioRiskDiagnosticService().build({ positions: composition.positions, signals: signalsResult.items, asOfDate: marketSnapshot.asOfDate });
      portfolioDiagnostic = await this.deps.diagnosticRepository.create({ userId, portfolioCompositionId: composition.id, asOfDate: marketSnapshot.asOfDate, diagnostic });
    }
    return {
      reports: persistedReports,
      portfolioDiagnostic,
      marketContext,
      errors: [...signalsResult.errors, ...evidenceResult.errors],
    };
  }

  private targets(input: TimingResearchRunInput) {
    const targets = new Map(input.targets.map((item) => [item.stockCode, item]));
    for (const position of input.portfolioComposition?.positions ?? []) targets.set(position.stockCode, position);
    return [...targets.values()];
  }
}
