/**
 * PrismaScreeningStrategyRepository 集成测试
 *
 * 测试 Prisma 仓储实现的 CRUD 操作和序列化/反序列化逻辑。
 *
 * Requirements: 1.1, 1.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PrismaClient } from "../../../../../generated/prisma/index";
import { PrismaScreeningStrategyRepository } from "../prisma-screening-strategy-repository";
import { ScreeningStrategy } from "../../../domain/screening/aggregates/screening-strategy";
import { FilterGroup } from "../../../domain/screening/entities/filter-group";
import { FilterCondition } from "../../../domain/screening/value-objects/filter-condition";
import { ScoringConfig } from "../../../domain/screening/value-objects/scoring-config";
import { IndicatorField } from "../../../domain/screening/enums/indicator-field";
import { ComparisonOperator } from "../../../domain/screening/enums/comparison-operator";
import { LogicalOperator } from "../../../domain/screening/enums/logical-operator";

describe("PrismaScreeningStrategyRepository", () => {
  let mockPrisma: any;
  let repository: PrismaScreeningStrategyRepository;
  const testUserId = "test-user-id";

  beforeEach(() => {
    // 创建 mock Prisma 客户端
    mockPrisma = {
      screeningStrategy: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    repository = new PrismaScreeningStrategyRepository(mockPrisma as unknown as PrismaClient);
  });

  /**
   * 创建测试用的筛选策略
   */
  function createTestStrategy(name: string): ScreeningStrategy {
    const condition = FilterCondition.create(
      IndicatorField.ROE,
      ComparisonOperator.GREATER_THAN,
      { type: "numeric", value: 0.15 }
    );

    const filters = FilterGroup.create(
      LogicalOperator.AND,
      [condition],
      []
    );

    const scoringConfig = ScoringConfig.create(
      new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ])
    );

    return ScreeningStrategy.create({
      name,
      description: "测试策略",
      filters,
      scoringConfig,
      tags: ["测试", "高ROE"],
      isTemplate: false,
      userId: testUserId,
    });
  }

  describe("save", () => {
    it("应该成功保存新策略", async () => {
      const strategy = createTestStrategy("测试策略1");
      mockPrisma.screeningStrategy.upsert.mockResolvedValue({});

      await repository.save(strategy);

      expect(mockPrisma.screeningStrategy.upsert).toHaveBeenCalledWith({
        where: { id: strategy.id },
        create: expect.objectContaining({
          id: strategy.id,
          name: "测试策略1",
          description: "测试策略",
        }),
        update: expect.objectContaining({
          name: "测试策略1",
          description: "测试策略",
        }),
      });
    });

    it("应该正确序列化 FilterGroup", async () => {
      const strategy = createTestStrategy("测试策略2");
      mockPrisma.screeningStrategy.upsert.mockResolvedValue({});

      await repository.save(strategy);

      const call = mockPrisma.screeningStrategy.upsert.mock.calls[0][0];
      expect(call.create.filters).toHaveProperty("operator");
      expect(call.create.filters).toHaveProperty("conditions");
    });

    it("应该正确序列化 ScoringConfig", async () => {
      const strategy = createTestStrategy("测试策略3");
      mockPrisma.screeningStrategy.upsert.mockResolvedValue({});

      await repository.save(strategy);

      const call = mockPrisma.screeningStrategy.upsert.mock.calls[0][0];
      expect(call.create.scoringConfig).toHaveProperty("weights");
      expect(call.create.scoringConfig).toHaveProperty("normalizationMethod");
    });
  });

  describe("findById", () => {
    it("应该找到已保存的策略", async () => {
      const strategy = createTestStrategy("测试策略5");
      const mockRecord = {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        filters: strategy.filters.toDict(),
        scoringConfig: strategy.scoringConfig.toDict(),
        tags: Array.from(strategy.tags),
        isTemplate: strategy.isTemplate,
        userId: strategy.userId,
        createdAt: strategy.createdAt,
        updatedAt: strategy.updatedAt,
      };
      mockPrisma.screeningStrategy.findUnique.mockResolvedValue(mockRecord);

      const found = await repository.findById(strategy.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(strategy.id);
      expect(found!.name).toBe(strategy.name);
    });

    it("应该对不存在的 ID 返回 null", async () => {
      mockPrisma.screeningStrategy.findUnique.mockResolvedValue(null);

      const found = await repository.findById("non-existent-id");

      expect(found).toBeNull();
    });
  });

  describe("delete", () => {
    it("应该成功删除策略", async () => {
      const strategy = createTestStrategy("测试策略6");
      mockPrisma.screeningStrategy.delete.mockResolvedValue({});

      await repository.delete(strategy.id);

      expect(mockPrisma.screeningStrategy.delete).toHaveBeenCalledWith({
        where: { id: strategy.id },
      });
    });
  });

  describe("findAll", () => {
    it("应该返回所有策略", async () => {
      const strategy1 = createTestStrategy("策略1");
      const strategy2 = createTestStrategy("策略2");
      
      mockPrisma.screeningStrategy.findMany.mockResolvedValue([
        {
          id: strategy1.id,
          name: strategy1.name,
          description: strategy1.description,
          filters: strategy1.filters.toDict(),
          scoringConfig: strategy1.scoringConfig.toDict(),
          tags: Array.from(strategy1.tags),
          isTemplate: strategy1.isTemplate,
          userId: strategy1.userId,
          createdAt: strategy1.createdAt,
          updatedAt: strategy1.updatedAt,
        },
        {
          id: strategy2.id,
          name: strategy2.name,
          description: strategy2.description,
          filters: strategy2.filters.toDict(),
          scoringConfig: strategy2.scoringConfig.toDict(),
          tags: Array.from(strategy2.tags),
          isTemplate: strategy2.isTemplate,
          userId: strategy2.userId,
          createdAt: strategy2.createdAt,
          updatedAt: strategy2.updatedAt,
        },
      ]);

      const all = await repository.findAll();

      expect(all.length).toBe(2);
      expect(all[0]!.name).toBe("策略1");
      expect(all[1]!.name).toBe("策略2");
    });

    it("应该支持分页（limit 和 offset）", async () => {
      mockPrisma.screeningStrategy.findMany.mockResolvedValue([]);

      await repository.findAll(10, 5);

      expect(mockPrisma.screeningStrategy.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 5,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findTemplates", () => {
    it("应该只返回模板策略", async () => {
      const templateStrategy = createTestStrategy("模板策略");
      templateStrategy.markAsTemplate();
      
      mockPrisma.screeningStrategy.findMany.mockResolvedValue([
        {
          id: templateStrategy.id,
          name: templateStrategy.name,
          description: templateStrategy.description,
          filters: templateStrategy.filters.toDict(),
          scoringConfig: templateStrategy.scoringConfig.toDict(),
          tags: Array.from(templateStrategy.tags),
          isTemplate: true,
          userId: templateStrategy.userId,
          createdAt: templateStrategy.createdAt,
          updatedAt: templateStrategy.updatedAt,
        },
      ]);

      const templates = await repository.findTemplates();

      expect(templates.length).toBe(1);
      expect(templates[0]!.isTemplate).toBe(true);
      expect(mockPrisma.screeningStrategy.findMany).toHaveBeenCalledWith({
        where: { isTemplate: true },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("findByName", () => {
    it("应该找到指定名称的策略", async () => {
      const strategy = createTestStrategy("唯一名称策略");
      
      mockPrisma.screeningStrategy.findFirst.mockResolvedValue({
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        filters: strategy.filters.toDict(),
        scoringConfig: strategy.scoringConfig.toDict(),
        tags: Array.from(strategy.tags),
        isTemplate: strategy.isTemplate,
        userId: strategy.userId,
        createdAt: strategy.createdAt,
        updatedAt: strategy.updatedAt,
      });

      const found = await repository.findByName("唯一名称策略");

      expect(found).not.toBeNull();
      expect(found!.name).toBe("唯一名称策略");
      expect(mockPrisma.screeningStrategy.findFirst).toHaveBeenCalledWith({
        where: { name: "唯一名称策略" },
      });
    });

    it("应该对不存在的名称返回 null", async () => {
      mockPrisma.screeningStrategy.findFirst.mockResolvedValue(null);

      const found = await repository.findByName("不存在的策略");

      expect(found).toBeNull();
    });
  });

  describe("序列化往返一致性", () => {
    it("应该保持复杂 FilterGroup 结构的一致性", async () => {
      // 创建嵌套的 FilterGroup
      const condition1 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      const condition2 = FilterCondition.create(
        IndicatorField.PE,
        ComparisonOperator.LESS_THAN,
        { type: "numeric", value: 30 }
      );

      const subGroup = FilterGroup.create(
        LogicalOperator.OR,
        [condition1, condition2],
        []
      );

      const condition3 = FilterCondition.create(
        IndicatorField.INDUSTRY,
        ComparisonOperator.IN,
        { type: "list", values: ["白酒", "医药"] }
      );

      const filters = FilterGroup.create(
        LogicalOperator.AND,
        [condition3],
        [subGroup]
      );

      const scoringConfig = ScoringConfig.create(
        new Map([
          [IndicatorField.ROE, 0.3],
          [IndicatorField.PE, 0.3],
          [IndicatorField.REVENUE_CAGR_3Y, 0.4],
        ])
      );

      const strategy = ScreeningStrategy.create({
        name: "复杂策略",
        description: "测试复杂结构",
        filters,
        scoringConfig,
        tags: ["复杂", "嵌套"],
        isTemplate: false,
        userId: testUserId,
      });

      // Mock 返回序列化后再反序列化的数据
      const mockRecord = {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        filters: strategy.filters.toDict(),
        scoringConfig: strategy.scoringConfig.toDict(),
        tags: Array.from(strategy.tags),
        isTemplate: strategy.isTemplate,
        userId: strategy.userId,
        createdAt: strategy.createdAt,
        updatedAt: strategy.updatedAt,
      };
      
      mockPrisma.screeningStrategy.upsert.mockResolvedValue(mockRecord);
      mockPrisma.screeningStrategy.findUnique.mockResolvedValue(mockRecord);

      await repository.save(strategy);
      const found = await repository.findById(strategy.id);

      expect(found).not.toBeNull();
      
      // 验证 FilterGroup 结构
      expect(found!.filters.operator).toBe(LogicalOperator.AND);
      expect(found!.filters.conditions.length).toBe(1);
      expect(found!.filters.subGroups.length).toBe(1);
      expect(found!.filters.subGroups[0]!.operator).toBe(LogicalOperator.OR);
      expect(found!.filters.subGroups[0]!.conditions.length).toBe(2);

      // 验证 ScoringConfig
      expect(found!.scoringConfig.getWeight(IndicatorField.ROE)).toBe(0.3);
      expect(found!.scoringConfig.getWeight(IndicatorField.PE)).toBe(0.3);
      expect(found!.scoringConfig.getWeight(IndicatorField.REVENUE_CAGR_3Y)).toBe(0.4);
    });
  });
});
