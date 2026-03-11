import { describe, expect, it } from "vitest";
import { InsightArchiveService } from "~/server/application/intelligence/insight-archive-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import type { ScreeningInsight } from "~/server/domain/intelligence/aggregates/screening-insight";
import { createUnavailableConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import type { ResearchReminder } from "~/server/domain/intelligence/entities/research-reminder";
import type { ScreeningInsightVersion } from "~/server/domain/intelligence/entities/screening-insight-version";
import type { IReminderRepository } from "~/server/domain/intelligence/repositories/reminder-repository";
import type { IScreeningInsightRepository } from "~/server/domain/intelligence/repositories/screening-insight-repository";
import { InsightQualityService } from "~/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/server/domain/intelligence/services/review-plan-policy";
import type { CompanyEvidence } from "~/server/domain/intelligence/types";
import { ScreeningSession } from "~/server/domain/screening/aggregates/screening-session";
import { FilterGroup } from "~/server/domain/screening/entities/filter-group";
import { IndicatorField } from "~/server/domain/screening/enums/indicator-field";
import { LogicalOperator } from "~/server/domain/screening/enums/logical-operator";
import { ScoredStock } from "~/server/domain/screening/value-objects/scored-stock";
import {
  NormalizationMethod,
  ScoringConfig,
} from "~/server/domain/screening/value-objects/scoring-config";
import { ScreeningResult } from "~/server/domain/screening/value-objects/screening-result";
import { StockCode } from "~/server/domain/screening/value-objects/stock-code";

class InMemoryInsightRepository implements IScreeningInsightRepository {
  private readonly insights = new Map<string, ScreeningInsight>();
  private readonly versions = new Map<string, ScreeningInsightVersion[]>();

  async save(insight: ScreeningInsight): Promise<ScreeningInsight> {
    const key = `${insight.screeningSessionId}:${insight.stockCode}`;
    const existing = this.insights.get(key);
    const nextVersion = existing ? existing.version + 1 : 1;
    const saved = insight.withPersistedVersion({
      version: nextVersion,
      latestVersionId: `${insight.id}-v${nextVersion}`,
      updatedAt: new Date("2026-03-08T12:00:00.000Z"),
    });

    this.insights.set(key, saved);
    this.versions.set(saved.id, [saved.createVersionSnapshot(nextVersion)]);
    return saved;
  }

  async findById(id: string): Promise<ScreeningInsight | null> {
    return [...this.insights.values()].find((item) => item.id === id) ?? null;
  }

  async findByUserId(): Promise<ScreeningInsight[]> {
    return [...this.insights.values()];
  }

  async findByScreeningSessionId(
    screeningSessionId: string,
  ): Promise<ScreeningInsight[]> {
    return [...this.insights.values()].filter(
      (item) => item.screeningSessionId === screeningSessionId,
    );
  }

  async findBySessionAndStockCode(
    screeningSessionId: string,
    stockCode: string,
  ): Promise<ScreeningInsight | null> {
    return this.insights.get(`${screeningSessionId}:${stockCode}`) ?? null;
  }

  async findVersions(insightId: string): Promise<ScreeningInsightVersion[]> {
    return this.versions.get(insightId) ?? [];
  }
}

class InMemoryReminderRepository implements IReminderRepository {
  readonly reminders = new Map<string, ResearchReminder>();

  async save(reminder: ResearchReminder): Promise<void> {
    this.reminders.set(reminder.id, reminder);
  }

  async findById(id: string): Promise<ResearchReminder | null> {
    return this.reminders.get(id) ?? null;
  }

  async findByInsightId(insightId: string): Promise<ResearchReminder[]> {
    return this.findByScreeningInsightId(insightId);
  }

  async findByScreeningInsightId(
    insightId: string,
  ): Promise<ResearchReminder[]> {
    return [...this.reminders.values()].filter(
      (item) => item.insightId === insightId,
    );
  }

  async findByTimingReviewRecordId(): Promise<ResearchReminder[]> {
    return [];
  }

  async findPendingByUserId(): Promise<ResearchReminder[]> {
    return [...this.reminders.values()].filter(
      (item) => item.status === "PENDING",
    );
  }
}

function createCompletedSession() {
  const stock = ScoredStock.create(
    StockCode.create("600519"),
    "贵州茅台",
    0.88,
    new Map([[IndicatorField.ROE, 0.88]]),
    new Map([[IndicatorField.ROE, 0.32]]),
    [
      {
        field: IndicatorField.ROE,
        operator: ">",
        value: { type: "numeric", value: 0.2 },
      },
    ],
    new Map([[IndicatorField.ROE, 0.88]]),
    ["ROE 表现优于筛选阈值"],
  );
  const result = ScreeningResult.create([stock], 120, 320);

  return ScreeningSession.create({
    strategyId: "strategy-1",
    strategyName: "高 ROE 价值",
    userId: "user-1",
    result,
    filtersSnapshot: FilterGroup.create(LogicalOperator.AND),
    scoringConfigSnapshot: ScoringConfig.create(
      new Map([[IndicatorField.ROE, 1]]),
      NormalizationMethod.MIN_MAX,
    ),
    executedAt: new Date("2026-03-08T10:00:00.000Z"),
  });
}

describe("InsightArchiveService", () => {
  it("会为已完成的筛选会话生成 insight 并安排提醒", async () => {
    const insightRepository = new InMemoryInsightRepository();
    const reminderRepository = new InMemoryReminderRepository();
    const synthesisService = new InsightSynthesisService({
      completionClient: {
        completeJson: async <T>(_messages: unknown, _fallback: T) => {
          return {
            thesis: {
              summary: "高端白酒需求韧性较强，值得继续研究。",
              whyNow: "筛选分数靠前，且品牌力与盈利能力继续保持优势。",
              drivers: ["高 ROE 持续", "龙头品牌力", "盈利能力稳定"],
              monetizationPath: "通过高端产品结构升级与渠道优化兑现利润。",
              confidence: "high",
            },
            risks: [
              {
                title: "需求回落",
                severity: "medium",
                description: "消费需求若转弱，增长可能放缓。",
                monitorMetric: "动销与批价",
                invalidatesThesisWhen: "动销连续走弱且批价失守时",
              },
            ],
            catalysts: [
              {
                title: "年报披露",
                windowType: "earnings",
                importance: 4,
                description: "年报窗口有望验证盈利韧性。",
                expectedDate: "2026-03-20T00:00:00.000Z",
              },
            ],
            extraChecks: ["跟踪年报披露与批价趋势"],
          } as T;
        },
      },
      reviewPlanPolicy: new ReviewPlanPolicy(),
      qualityService: new InsightQualityService(),
    });
    const archiveService = new InsightArchiveService({
      insightRepository,
      dataClient: {
        getEvidence: async (): Promise<CompanyEvidence> => ({
          stockCode: "600519",
          companyName: "贵州茅台",
          concept: "高端白酒",
          evidenceSummary: "公司品牌力和盈利能力持续领先，渠道价盘相对稳健。",
          catalysts: ["年报披露"],
          risks: ["需求波动"],
          credibilityScore: 0.84,
          updatedAt: "2026-03-08T09:30:00.000Z",
        }),
      },
      synthesisService,
      confidenceAnalysisService: {
        analyzeScreeningInsight: async () =>
          createUnavailableConfidenceAnalysis(["test fallback"]),
      } as never,
      reminderSchedulingService: new ReminderSchedulingService({
        reminderRepository,
      }),
    });

    const insights = await archiveService.archiveSessionInsights(
      createCompletedSession(),
    );

    expect(insights).toHaveLength(1);
    expect(insights[0]?.stockCode).toBe("600519");
    expect(insights[0]?.status).toBe("ACTIVE");
    expect(insights[0]?.version).toBe(1);
    expect(insights[0]?.qualityFlags).toEqual([]);

    const firstInsight = insights[0];
    if (!firstInsight) {
      throw new Error("expected generated insight");
    }

    const reminders = await reminderRepository.findByInsightId(firstInsight.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.reminderType).toBe("REVIEW");
    expect(reminders[0]?.status).toBe("PENDING");
  });
});
