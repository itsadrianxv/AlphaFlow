/**
 * PrismaScreeningSessionRepository 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "../../../../../generated/prisma/index";
import { PrismaScreeningSessionRepository } from "../prisma-screening-session-repository";
import { ScreeningSession } from "../../../domain/screening/aggregates/screening-session";
import { ScreeningResult } from "../../../domain/screening/value-objects/screening-result";
import { ScoredStock } from "../../../domain/screening/value-objects/scored-stock";
import { StockCode } from "../../../domain/screening/value-objects/stock-code";
import { FilterGroup } from "../../../domain/screening/entities/filter-group";
import { FilterCondition } from "../../../domain/screening/value-objects/filter-condition";
import { ScoringConfig, NormalizationMethod } from "../../../domain/screening/value-objects/scoring-config";
import { IndicatorField } from "../../../domain/screening/enums/indicator-field";
import { ComparisonOperator } from "../../../domain/screening/enums/comparison-operator";
import { LogicalOperator } from "../../../domain/screening/enums/logical-operator";

describe("PrismaScreeningSessionRepository", () => {
  let prisma: PrismaClient;
  let repository: PrismaScreeningSessionRepository;
  let testUserId: string;
  let testStrategyId1: string;
  let testStrategyId2: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    repository = new PrismaScreeningSessionRepository(prisma);

    // 创建测试用户
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
      },
    });
    testUserId = user.id;

    // 创建测试策略
    const strategy1 = await prisma.screeningStrategy.create({
      data: {
        name: "测试策略 1",
        filters: {},
        scoringConfig: {},
        userId: testUserId,
      },
    });
    testStrategyId1 = strategy1.id;

    const strategy2 = await prisma.screeningStrategy.create({
      data: {
        name: "测试策略 2",
        filters: {},
        scoringConfig: {},
        userId: testUserId,
      },
    });
    testStrategyId2 = strategy2.id;
  });

  afterEach(async () => {
    // 清理测试数据
    await prisma.screeningSession.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.screeningStrategy.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.delete({
      where: { id: testUserId },
    });
    await prisma.$disconnect();
  });

  function createTestFilterGroup(): FilterGroup {
    const condition = FilterCondition.create(
      IndicatorField.ROE,
      ComparisonOperator.GREATER_THAN,
      { type: "numeric", value: 0.15 }
    );
    return FilterGroup.create(LogicalOperator.AND, [condition], []);
  }

  function createTestScoringConfig(): ScoringConfig {
    return ScoringConfig.create(
      new Map([[IndicatorField.ROE, 1.0]]),
      NormalizationMethod.MIN_MAX
    );
  }

  function createScoredStock(code: string, name: string, score: number): ScoredStock {
    return ScoredStock.create(
      StockCode.create(code),
      name,
      score,
      new Map([[IndicatorField.ROE, score]]),
      new Map([[IndicatorField.ROE, score * 0.3]]),
      []
    );
  }

  describe("save", () => {
    it("应该成功保存新的筛选会话", async () => {
      const stocks = [
        createScoredStock("600519", "贵州茅台", 0.9),
        createScoredStock("000858", "五粮液", 0.8),
      ];

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: null,
        strategyName: "高 ROE 策略",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      await repository.save(session);

      const found = await repository.findById(session.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(session.id);
      expect(found!.strategyName).toBe("高 ROE 策略");
      expect(found!.countMatched()).toBe(2);
    });

    it("应该成功更新已存在的筛选会话", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: null,
        strategyName: "原始策略名",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      await repository.save(session);

      // 创建新的会话对象（相同 ID，不同名称）
      const stocks2 = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result2 = ScreeningResult.create(stocks2, 5000, 1250.5);
      const updatedSession = ScreeningSession.fromDict({
        ...session.toDict(),
        strategyName: "更新后的策略名",
      });

      await repository.save(updatedSession);

      const found = await repository.findById(session.id);
      expect(found).not.toBeNull();
      expect(found!.strategyName).toBe("更新后的策略名");
    });
  });

  describe("findById", () => {
    it("应该找到已保存的筛选会话", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: null,
        strategyName: "测试策略",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      await repository.save(session);

      const found = await repository.findById(session.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(session.id);
    });

    it("应该对不存在的 ID 返回 null", async () => {
      const found = await repository.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("delete", () => {
    it("应该成功删除筛选会话", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: null,
        strategyName: "测试策略",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      await repository.save(session);
      await repository.delete(session.id);

      const found = await repository.findById(session.id);
      expect(found).toBeNull();
    });
  });

  describe("findByStrategy", () => {
    it("应该找到指定策略的所有会话", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);

      const session1 = ScreeningSession.create({
        strategyId: testStrategyId1,
        strategyName: "策略 1",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const session2 = ScreeningSession.create({
        strategyId: testStrategyId1,
        strategyName: "策略 1",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const session3 = ScreeningSession.create({
        strategyId: testStrategyId2,
        strategyName: "策略 2",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      await repository.save(session1);
      await repository.save(session2);
      await repository.save(session3);

      const found = await repository.findByStrategy(testStrategyId1);
      expect(found).toHaveLength(2);
      expect(found.every((s) => s.strategyId === testStrategyId1)).toBe(true);
    });

    it("应该支持限制返回数量", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);

      for (let i = 0; i < 5; i++) {
        const session = ScreeningSession.create({
          strategyId: testStrategyId1,
          strategyName: "策略 1",
          userId: testUserId,
          result,
          filtersSnapshot: createTestFilterGroup(),
          scoringConfigSnapshot: createTestScoringConfig(),
        });
        await repository.save(session);
      }

      const found = await repository.findByStrategy(testStrategyId1, 3);
      expect(found).toHaveLength(3);
    });
  });

  describe("findRecentSessions", () => {
    it("应该按执行时间降序返回会话", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);

      const session1 = ScreeningSession.create({
        strategyId: testStrategyId1,
        strategyName: "策略 1",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
        executedAt: new Date("2024-01-01"),
      });

      const session2 = ScreeningSession.create({
        strategyId: testStrategyId2,
        strategyName: "策略 2",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
        executedAt: new Date("2024-01-03"),
      });

      const session3 = ScreeningSession.create({
        strategyId: testStrategyId1,
        strategyName: "策略 3",
        userId: testUserId,
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
        executedAt: new Date("2024-01-02"),
      });

      await repository.save(session1);
      await repository.save(session2);
      await repository.save(session3);

      const found = await repository.findRecentSessions();
      expect(found).toHaveLength(3);
      expect(found[0]!.executedAt.getTime()).toBeGreaterThanOrEqual(
        found[1]!.executedAt.getTime()
      );
      expect(found[1]!.executedAt.getTime()).toBeGreaterThanOrEqual(
        found[2]!.executedAt.getTime()
      );
    });

    it("应该支持限制返回数量", async () => {
      const stocks = [createScoredStock("600519", "贵州茅台", 0.9)];
      const result = ScreeningResult.create(stocks, 5000, 1250.5);

      for (let i = 0; i < 5; i++) {
        const session = ScreeningSession.create({
          strategyId: i % 2 === 0 ? testStrategyId1 : testStrategyId2,
          strategyName: `策略 ${i}`,
          userId: testUserId,
          result,
          filtersSnapshot: createTestFilterGroup(),
          scoringConfigSnapshot: createTestScoringConfig(),
        });
        await repository.save(session);
      }

      const found = await repository.findRecentSessions(3);
      expect(found).toHaveLength(3);
    });
  });
});
