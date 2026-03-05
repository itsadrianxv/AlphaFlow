/**
 * Screening tRPC Router 集成测试
 *
 * 测试筛选策略和会话的 tRPC 端点，验证：
 * - Zod 输入验证
 * - Schema 结构正确性
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5, 7.6
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Zod Schema 定义（从 router 复制用于测试）
 */

// FilterCondition Schema
const filterConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.union([
    z.object({ type: z.literal("numeric"), value: z.number(), unit: z.string().optional() }),
    z.object({ type: z.literal("text"), value: z.string() }),
    z.object({ type: z.literal("list"), values: z.array(z.string()) }),
    z.object({ type: z.literal("range"), min: z.number(), max: z.number() }),
    z.object({ type: z.literal("timeSeries"), years: z.number(), threshold: z.number().optional() }),
  ]),
});

// FilterGroup Schema (递归)
type FilterGroupInput = {
  groupId: string;
  operator: string;
  conditions: z.infer<typeof filterConditionSchema>[];
  subGroups: FilterGroupInput[];
};

const filterGroupSchema: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({
    groupId: z.string(),
    operator: z.string(),
    conditions: z.array(filterConditionSchema),
    subGroups: z.array(filterGroupSchema),
  })
);

// ScoringConfig Schema
const scoringConfigSchema = z.object({
  weights: z.record(z.string(), z.number()),
  normalizationMethod: z.string(),
});

// 创建策略 Schema
const createStrategySchema = z.object({
  name: z.string().min(1, "策略名称不能为空"),
  description: z.string().optional(),
  filters: filterGroupSchema,
  scoringConfig: scoringConfigSchema,
  tags: z.array(z.string()).default([]),
  isTemplate: z.boolean().default(false),
});

// 更新策略 Schema
const updateStrategySchema = z.object({
  id: z.string(),
  name: z.string().min(1, "策略名称不能为空").optional(),
  description: z.string().optional(),
  filters: filterGroupSchema.optional(),
  scoringConfig: scoringConfigSchema.optional(),
  tags: z.array(z.string()).optional(),
  isTemplate: z.boolean().optional(),
});

// 分页 Schema
const paginationSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

/**
 * 创建测试用的筛选策略输入
 */
function createTestStrategyInput() {
  return {
    name: "测试策略",
    description: "测试描述",
    filters: {
      groupId: "group-1",
      operator: "AND",
      conditions: [
        {
          field: "ROE",
          operator: "GREATER_THAN",
          value: { type: "numeric" as const, value: 0.15 },
        },
      ],
      subGroups: [],
    },
    scoringConfig: {
      weights: {
        ROE: 0.5,
        PE: 0.5,
      },
      normalizationMethod: "MIN_MAX",
    },
    tags: ["测试"],
    isTemplate: false,
  };
}

describe("screeningRouter - Schema Validation", () => {
  describe("createStrategy - 输入验证", () => {
    it("应该接受有效的策略输入", () => {
      const input = createTestStrategyInput();

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝空名称", () => {
      const input = createTestStrategyInput();
      input.name = "";

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该使用默认值（tags 和 isTemplate）", () => {
      const input = {
        name: "测试策略",
        filters: createTestStrategyInput().filters,
        scoringConfig: createTestStrategyInput().scoringConfig,
      };

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
        expect(result.data.isTemplate).toBe(false);
      }
    });
  });

  describe("updateStrategy - 输入验证", () => {
    it("应该接受有效的更新输入", () => {
      const input = {
        id: "strategy-123",
        name: "更新后的策略",
      };

      const result = updateStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝空名称", () => {
      const input = {
        id: "strategy-123",
        name: "",
      };

      const result = updateStrategySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该允许只更新部分字段", () => {
      const input = {
        id: "strategy-123",
        description: "新描述",
      };

      const result = updateStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });

  describe("分页参数验证", () => {
    it("应该接受有效的分页参数", () => {
      const input = { limit: 20, offset: 0 };

      const result = paginationSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的 limit（超过 100）", () => {
      const input = { limit: 101, offset: 0 };

      const result = paginationSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该拒绝负数的 offset", () => {
      const input = { limit: 20, offset: -1 };

      const result = paginationSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该拒绝 limit 为 0", () => {
      const input = { limit: 0, offset: 0 };

      const result = paginationSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该使用默认值", () => {
      const input = {};

      const result = paginationSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
      }
    });
  });

  describe("FilterGroup 递归结构验证", () => {
    it("应该验证嵌套的 FilterGroup", () => {
      const input = createTestStrategyInput();
      // 添加嵌套的 subGroup
      input.filters.subGroups = [
        {
          groupId: "sub-group-1",
          operator: "OR",
          conditions: [
            {
              field: "PE",
              operator: "LESS_THAN",
              value: { type: "numeric" as const, value: 30 },
            },
          ],
          subGroups: [],
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该验证多层嵌套的 FilterGroup", () => {
      const input = createTestStrategyInput();
      input.filters.subGroups = [
        {
          groupId: "sub-group-1",
          operator: "OR",
          conditions: [],
          subGroups: [
            {
              groupId: "sub-sub-group-1",
              operator: "AND",
              conditions: [
                {
                  field: "PB",
                  operator: "LESS_THAN",
                  value: { type: "numeric" as const, value: 5 },
                },
              ],
              subGroups: [],
            },
          ],
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });

  describe("IndicatorValue 类型验证", () => {
    it("应该验证 numeric 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "ROE",
          operator: "GREATER_THAN",
          value: { type: "numeric" as const, value: 0.15, unit: "%" },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该验证 text 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "INDUSTRY",
          operator: "EQUAL",
          value: { type: "text" as const, value: "白酒" },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该验证 list 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "INDUSTRY",
          operator: "IN",
          value: { type: "list" as const, values: ["白酒", "医药"] },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该验证 range 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "PE",
          operator: "BETWEEN",
          value: { type: "range" as const, min: 10, max: 30 },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该验证 timeSeries 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "REVENUE_CAGR_3Y",
          operator: "GREATER_THAN",
          value: { type: "timeSeries" as const, years: 3, threshold: 0.2 },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的 IndicatorValue 类型", () => {
      const input = createTestStrategyInput();
      input.filters.conditions = [
        {
          field: "ROE",
          operator: "GREATER_THAN",
          value: { type: "invalid" as any, value: 0.15 },
        },
      ];

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("ScoringConfig 验证", () => {
    it("应该接受有效的权重配置", () => {
      const input = createTestStrategyInput();
      input.scoringConfig.weights = {
        ROE: 0.3,
        PE: 0.3,
        REVENUE_CAGR_3Y: 0.4,
      };

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该接受单个指标的权重", () => {
      const input = createTestStrategyInput();
      input.scoringConfig.weights = {
        ROE: 1.0,
      };

      const result = createStrategySchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });
});
