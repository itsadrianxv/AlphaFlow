/**
 * ScreeningStrategy 聚合根属性基测试
 *
 * Feature: stock-screening-platform
 * Property 1: 策略业务不变量验证
 *
 * 对于任意 ScreeningStrategy，在创建或更新后，以下不变量必须同时成立：
 * (a) name 非空
 * (b) filters 包含至少一个有效条件（递归检查）
 * (c) scoringConfig 的权重之和等于 1.0（浮点精度 ±0.001）
 *
 * 违反任一不变量的操作应被拒绝并抛出验证错误。
 *
 * **Validates: Requirements 1.2, 1.5, 1.6**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ScreeningStrategy } from "../index.js";
import { FilterGroup } from "../../entities/filter-group.js";
import { FilterCondition } from "../../value-objects/filter-condition.js";
import { ScoringConfig, NormalizationMethod } from "../../value-objects/scoring-config.js";
import { InvalidStrategyError } from "../../errors.js";
import { LogicalOperator } from "../../enums/logical-operator.js";
import { IndicatorField } from "../../enums/indicator-field.js";
import { ComparisonOperator } from "../../enums/comparison-operator.js";
import type { IndicatorValue } from "../../value-objects/indicator-value.js";

// Local generators to avoid circular dependencies
const arbStrategyName = fc.string({ minLength: 1, maxLength: 50 }).filter(name => name.trim().length > 0);
const arbUserId = fc.uuid();

const arbNumericIndicatorField = fc.constantFrom(
  IndicatorField.ROE,
  IndicatorField.PE,
  IndicatorField.PB,
  IndicatorField.EPS
);

const arbNumericValue = fc
  .double({ min: -1000, max: 10000, noNaN: true })
  .map((value): IndicatorValue => ({ type: "numeric", value }));

const arbTextValue = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((value): IndicatorValue => ({ type: "text", value }));

const arbListValue = fc
  .array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 })
  .map((values): IndicatorValue => ({ type: "list", values }));

const arbValidFilterCondition = fc
  .oneof(
    fc.tuple(arbNumericIndicatorField, fc.constant(ComparisonOperator.GREATER_THAN), arbNumericValue),
    fc.tuple(fc.constant(IndicatorField.INDUSTRY), fc.constant(ComparisonOperator.IN), arbListValue),
    fc.tuple(fc.constant(IndicatorField.INDUSTRY), fc.constant(ComparisonOperator.NOT_EQUAL), arbTextValue)
  )
  .map(([field, operator, value]) => FilterCondition.create(field, operator, value));

const arbFilterGroup = (maxDepth = 2): fc.Arbitrary<FilterGroup> => {
  const arbLeafGroup = fc
    .array(arbValidFilterCondition, { minLength: 1, maxLength: 2 })
    .map((conditions) => FilterGroup.create(LogicalOperator.AND, conditions, []));

  if (maxDepth <= 1) {
    return arbLeafGroup;
  }

  const arbRecursiveGroup = fc
    .tuple(
      fc.array(arbValidFilterCondition, { minLength: 1, maxLength: 2 }),
      fc.array(arbFilterGroup(maxDepth - 1), { minLength: 0, maxLength: 1 })
    )
    .map(([conditions, subGroups]) =>
      FilterGroup.create(LogicalOperator.AND, conditions, subGroups)
    );

  return fc.oneof(arbLeafGroup, arbRecursiveGroup);
};

const arbScoringConfig = fc
  .array(
    fc.tuple(
      arbNumericIndicatorField,
      fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true })
    ),
    { minLength: 1, maxLength: 3 }
  )
  .chain((pairs) => {
    const uniquePairs = Array.from(
      new Map(pairs.map(([field, weight]) => [field, weight])).entries()
    );

    if (uniquePairs.length === 0) {
      return fc.constant(
        ScoringConfig.create(
          new Map([[IndicatorField.ROE, 1.0]]),
          NormalizationMethod.MIN_MAX
        )
      );
    }

    const totalWeight = uniquePairs.reduce((sum, [, weight]) => sum + weight, 0);
    const normalizedWeights = new Map(
      uniquePairs.map(([field, weight]) => [field, weight / totalWeight])
    );

    return fc.constant(
      ScoringConfig.create(normalizedWeights, NormalizationMethod.MIN_MAX)
    );
  });

describe("ScreeningStrategy - Property-Based Tests", () => {
  describe("Property 1: 策略业务不变量验证", () => {
    it("应该接受所有满足不变量的策略参数", () => {
      fc.assert(
        fc.property(
          arbStrategyName,
          arbFilterGroup(),
          arbScoringConfig,
          arbUserId,
          (name, filters, scoringConfig, userId) => {
            // 当所有不变量都满足时，创建应该成功
            const strategy = ScreeningStrategy.create({
              name,
              filters,
              scoringConfig,
              userId,
            });

            // 验证不变量 (a): name 非空
            expect(strategy.name).toBe(name);
            expect(strategy.name.trim().length).toBeGreaterThan(0);

            // 验证不变量 (b): filters 包含至少一个有效条件
            expect(filters.hasAnyCondition()).toBe(true);

            // 验证不变量 (c): scoringConfig 权重之和等于 1.0（±0.001）
            const totalWeight = Array.from(scoringConfig.weights.values()).reduce(
              (sum, weight) => sum + weight,
              0
            );
            expect(Math.abs(totalWeight - 1.0)).toBeLessThanOrEqual(0.001);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("应该拒绝空名称的策略", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("", "   ", "\t", "\n", "  \t\n  "),
          arbValidFilterCondition,
          arbScoringConfig,
          arbUserId,
          (emptyName, condition, scoringConfig, userId) => {
            // 违反不变量 (a): name 为空或仅包含空白字符
            const filters = FilterGroup.create(LogicalOperator.AND, [condition], []);
            
            expect(() =>
              ScreeningStrategy.create({
                name: emptyName,
                filters,
                scoringConfig,
                userId,
              })
            ).toThrow(InvalidStrategyError);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("应该拒绝没有任何条件的 FilterGroup", () => {
      fc.assert(
        fc.property(
          arbStrategyName,
          arbScoringConfig,
          arbUserId,
          (name, scoringConfig, userId) => {
            // 违反不变量 (b): filters 不包含任何条件
            const emptyFilterGroup = FilterGroup.create(
              LogicalOperator.AND,
              [],
              []
            );

            expect(() =>
              ScreeningStrategy.create({
                name,
                filters: emptyFilterGroup,
                scoringConfig,
                userId,
              })
            ).toThrow(InvalidStrategyError);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("应该拒绝权重之和不为 1.0 的 ScoringConfig", () => {
      fc.assert(
        fc.property(
          arbStrategyName,
          arbValidFilterCondition,
          arbUserId,
          fc.array(
            fc.tuple(
              arbNumericIndicatorField,
              fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true })
            ),
            { minLength: 1, maxLength: 5 }
          ),
          fc.double({ min: 0.1, max: 0.9, noNaN: true, noDefaultInfinity: true }),
          (name, condition, userId, weightPairs, invalidFactor) => {
            // 违反不变量 (c): 权重之和不等于 1.0
            // 通过乘以一个不等于 1 的因子来破坏权重和
            const totalWeight = weightPairs.reduce(
              (sum, [, weight]) => sum + weight,
              0
            );
            const invalidWeights = new Map(
              weightPairs.map(([field, weight]) => [
                field,
                (weight / totalWeight) * invalidFactor,
              ])
            );

            // ScoringConfig.create 应该在创建时就拒绝无效权重
            expect(() =>
              ScoringConfig.create(invalidWeights, NormalizationMethod.MIN_MAX)
            ).toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it("更新后应该重新验证所有不变量", () => {
      fc.assert(
        fc.property(
          arbStrategyName,
          arbFilterGroup(),
          arbScoringConfig,
          arbUserId,
          (name, filters, scoringConfig, userId) => {
            // 创建有效策略
            const strategy = ScreeningStrategy.create({
              name,
              filters,
              scoringConfig,
              userId,
            });

            // 尝试更新为空名称应该失败
            expect(() =>
              strategy.update({
                name: "",
              })
            ).toThrow(InvalidStrategyError);

            // 尝试更新为空 FilterGroup 应该失败
            const emptyFilterGroup = FilterGroup.create(
              LogicalOperator.AND,
              [],
              []
            );
            expect(() =>
              strategy.update({
                filters: emptyFilterGroup,
              })
            ).toThrow(InvalidStrategyError);

            // 原始策略应该保持不变
            expect(strategy.name).toBe(name);
            expect(strategy.filters.hasAnyCondition()).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("不变量验证应该是原子性的（全部满足或全部拒绝）", () => {
      fc.assert(
        fc.property(
          arbStrategyName,
          arbFilterGroup(),
          arbScoringConfig,
          arbUserId,
          (name, filters, scoringConfig, userId) => {
            // 创建有效策略
            const strategy = ScreeningStrategy.create({
              name,
              filters,
              scoringConfig,
              userId,
            });

            const originalName = strategy.name;
            const originalFilters = strategy.filters;

            // 尝试同时更新为无效的名称和无效的 FilterGroup
            const emptyFilterGroup = FilterGroup.create(
              LogicalOperator.AND,
              [],
              []
            );

            expect(() =>
              strategy.update({
                name: "",
                filters: emptyFilterGroup,
              })
            ).toThrow(InvalidStrategyError);

            // 验证策略状态完全没有改变（原子性）
            expect(strategy.name).toBe(originalName);
            expect(strategy.filters).toBe(originalFilters);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
