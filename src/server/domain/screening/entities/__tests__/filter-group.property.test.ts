/**
 * FilterGroup 实体属性基测试
 *
 * Feature: stock-screening-platform
 * Property 4: FilterGroup 与 FilterCondition 序列化往返一致性
 *
 * 对于任意有效的 FilterGroup（包含任意深度的递归嵌套和各类 FilterCondition），
 * 执行 `FilterGroup.fromDict(filterGroup.toDict())` 应产生与原始 FilterGroup 结构等价的对象。
 *
 * **Validates: Requirements 2.5, 2.6**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FilterGroup } from "../filter-group";
import { FilterCondition } from "../../value-objects/filter-condition";
import { LogicalOperator } from "../../enums/logical-operator";
import { arbValidFilterCondition, arbFilterGroup, arbStock } from "../../__tests__/generators";
import { Stock } from "../stock";

/**
 * Mock IIndicatorCalculationService for testing
 * 简单实现：直接从 Stock 获取 BASIC 指标值
 */
class MockIndicatorCalculationService {
  calculateIndicator(indicator: string, stock: Stock): number | string | null {
    return stock.getValue(indicator as any);
  }
}

describe("FilterGroup - Property-Based Tests", () => {
  describe("Property 4: FilterGroup 与 FilterCondition 序列化往返一致性", () => {
    it("应该对任意 FilterGroup 保持序列化往返一致性", () => {
      fc.assert(
        fc.property(arbFilterGroup(), (originalGroup) => {
          // 执行序列化和反序列化
          const serialized = originalGroup.toDict();
          const restored = FilterGroup.fromDict(serialized);

          // 验证结构等价性
          assertFilterGroupEquals(originalGroup, restored);
        }),
        { numRuns: 100 }
      );
    });

    it("应该对深度嵌套的 FilterGroup 保持序列化往返一致性", () => {
      fc.assert(
        fc.property(arbFilterGroup(5), (originalGroup) => {
          // 执行序列化和反序列化
          const serialized = originalGroup.toDict();
          const restored = FilterGroup.fromDict(serialized);

          // 验证结构等价性
          assertFilterGroupEquals(originalGroup, restored);
        }),
        { numRuns: 50 }
      );
    });

    it("应该对包含 NOT 运算符的 FilterGroup 保持序列化往返一致性", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // NOT 组包含单个条件
            arbValidFilterCondition.map((condition) =>
              FilterGroup.create(LogicalOperator.NOT, [condition], [])
            ),
            // NOT 组包含单个子组
            arbFilterGroup(2).map((subGroup) =>
              FilterGroup.create(LogicalOperator.NOT, [], [subGroup])
            )
          ),
          (originalGroup) => {
            // 执行序列化和反序列化
            const serialized = originalGroup.toDict();
            const restored = FilterGroup.fromDict(serialized);

            // 验证结构等价性
            assertFilterGroupEquals(originalGroup, restored);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("应该对包含各种 FilterCondition 类型的 FilterGroup 保持序列化往返一致性", () => {
      fc.assert(
        fc.property(
          fc.array(arbValidFilterCondition, { minLength: 1, maxLength: 5 }),
          fc.constantFrom(LogicalOperator.AND, LogicalOperator.OR),
          (conditions, operator) => {
            const originalGroup = FilterGroup.create(operator, conditions, []);

            // 执行序列化和反序列化
            const serialized = originalGroup.toDict();
            const restored = FilterGroup.fromDict(serialized);

            // 验证结构等价性
            assertFilterGroupEquals(originalGroup, restored);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("序列化后的对象应该可以被 JSON.stringify 处理", () => {
      fc.assert(
        fc.property(arbFilterGroup(), (originalGroup) => {
          const serialized = originalGroup.toDict();

          // 验证可以被 JSON 序列化
          const jsonString = JSON.stringify(serialized);
          expect(jsonString).toBeDefined();
          expect(jsonString.length).toBeGreaterThan(0);

          // 验证可以从 JSON 反序列化
          const parsed = JSON.parse(jsonString) as Record<string, unknown>;
          const restored = FilterGroup.fromDict(parsed);

          // 验证结构等价性
          assertFilterGroupEquals(originalGroup, restored);
        }),
        { numRuns: 100 }
      );
    });

    it("多次序列化往返应该保持一致性", () => {
      fc.assert(
        fc.property(arbFilterGroup(), (originalGroup) => {
          // 第一次往返
          const serialized1 = originalGroup.toDict();
          const restored1 = FilterGroup.fromDict(serialized1);

          // 第二次往返
          const serialized2 = restored1.toDict();
          const restored2 = FilterGroup.fromDict(serialized2);

          // 第三次往返
          const serialized3 = restored2.toDict();
          const restored3 = FilterGroup.fromDict(serialized3);

          // 验证所有版本都等价
          assertFilterGroupEquals(originalGroup, restored1);
          assertFilterGroupEquals(originalGroup, restored2);
          assertFilterGroupEquals(originalGroup, restored3);
          assertFilterGroupEquals(restored1, restored2);
          assertFilterGroupEquals(restored2, restored3);
        }),
        { numRuns: 50 }
      );
    });
  });
});

/**
 * 断言两个 FilterGroup 结构等价
 *
 * 验证以下属性：
 * - groupId 相同
 * - operator 相同
 * - conditions 数量和内容相同
 * - subGroups 数量和内容相同（递归验证）
 */
function assertFilterGroupEquals(
  group1: FilterGroup,
  group2: FilterGroup
): void {
  // 验证 groupId
  expect(group2.groupId).toBe(group1.groupId);

  // 验证 operator
  expect(group2.operator).toBe(group1.operator);

  // 验证 conditions 数量
  expect(group2.conditions.length).toBe(group1.conditions.length);

  // 验证每个 condition 的内容
  for (let i = 0; i < group1.conditions.length; i++) {
    const condition1 = group1.conditions[i]!;
    const condition2 = group2.conditions[i]!;
    assertFilterConditionEquals(condition1, condition2);
  }

  // 验证 subGroups 数量
  expect(group2.subGroups.length).toBe(group1.subGroups.length);

  // 递归验证每个 subGroup
  for (let i = 0; i < group1.subGroups.length; i++) {
    const subGroup1 = group1.subGroups[i]!;
    const subGroup2 = group2.subGroups[i]!;
    assertFilterGroupEquals(subGroup1, subGroup2);
  }
}

/**
 * 断言两个 FilterCondition 相等
 */
function assertFilterConditionEquals(
  condition1: FilterCondition,
  condition2: FilterCondition
): void {
  expect(condition2.field).toBe(condition1.field);
  expect(condition2.operator).toBe(condition1.operator);

  // 使用 FilterCondition 的 equals 方法验证值相等
  expect(condition1.equals(condition2)).toBe(true);
}

describe("FilterGroup - Property 5: 递归匹配语义正确性", () => {
  const calcService = new MockIndicatorCalculationService();

  describe("Property 5: FilterGroup 递归匹配语义正确性", () => {
    it("AND 组：所有子条件和子组都匹配时返回 true", () => {
      fc.assert(
        fc.property(
          fc.array(arbValidFilterCondition, { minLength: 2, maxLength: 4 }),
          arbStock,
          (conditions, stock) => {
            const group = FilterGroup.create(LogicalOperator.AND, conditions, []);
            
            // 评估每个条件
            const conditionResults = conditions.map(c => c.evaluate(stock, calcService));
            
            // 验证 AND 语义：所有条件都匹配时返回 true
            const expectedResult = conditionResults.every(r => r);
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("OR 组：至少一个子条件或子组匹配时返回 true", () => {
      fc.assert(
        fc.property(
          fc.array(arbValidFilterCondition, { minLength: 2, maxLength: 4 }),
          arbStock,
          (conditions, stock) => {
            const group = FilterGroup.create(LogicalOperator.OR, conditions, []);
            
            // 评估每个条件
            const conditionResults = conditions.map(c => c.evaluate(stock, calcService));
            
            // 验证 OR 语义：至少一个条件匹配时返回 true
            const expectedResult = conditionResults.some(r => r);
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("NOT 组：对唯一子条件的匹配结果取反", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbStock,
          (condition, stock) => {
            const group = FilterGroup.create(LogicalOperator.NOT, [condition], []);
            
            // 评估条件
            const conditionResult = condition.evaluate(stock, calcService);
            
            // 验证 NOT 语义：对条件结果取反
            const expectedResult = !conditionResult;
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("NOT 组：对唯一子组的匹配结果取反", () => {
      fc.assert(
        fc.property(
          arbFilterGroup(2),
          arbStock,
          (subGroup, stock) => {
            const group = FilterGroup.create(LogicalOperator.NOT, [], [subGroup]);
            
            // 评估子组
            const subGroupResult = subGroup.match(stock, calcService);
            
            // 验证 NOT 语义：对子组结果取反
            const expectedResult = !subGroupResult;
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("嵌套 AND 组：递归验证所有层级的 AND 语义", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbValidFilterCondition,
          arbFilterGroup(2),
          arbStock,
          (condition1, condition2, subGroup, stock) => {
            // 创建嵌套结构：AND(condition1, condition2, subGroup)
            const group = FilterGroup.create(
              LogicalOperator.AND,
              [condition1, condition2],
              [subGroup]
            );
            
            // 评估所有元素
            const condition1Result = condition1.evaluate(stock, calcService);
            const condition2Result = condition2.evaluate(stock, calcService);
            const subGroupResult = subGroup.match(stock, calcService);
            
            // 验证 AND 语义：所有元素都匹配时返回 true
            const expectedResult = condition1Result && condition2Result && subGroupResult;
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("嵌套 OR 组：递归验证所有层级的 OR 语义", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbValidFilterCondition,
          arbFilterGroup(2),
          arbStock,
          (condition1, condition2, subGroup, stock) => {
            // 创建嵌套结构：OR(condition1, condition2, subGroup)
            const group = FilterGroup.create(
              LogicalOperator.OR,
              [condition1, condition2],
              [subGroup]
            );
            
            // 评估所有元素
            const condition1Result = condition1.evaluate(stock, calcService);
            const condition2Result = condition2.evaluate(stock, calcService);
            const subGroupResult = subGroup.match(stock, calcService);
            
            // 验证 OR 语义：至少一个元素匹配时返回 true
            const expectedResult = condition1Result || condition2Result || subGroupResult;
            const actualResult = group.match(stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("复杂嵌套：验证多层递归的语义正确性", () => {
      fc.assert(
        fc.property(
          arbFilterGroup(3),
          arbStock,
          (group, stock) => {
            // 手动递归验证整个树的语义
            const actualResult = group.match(stock, calcService);
            const expectedResult = manuallyEvaluateGroup(group, stock, calcService);
            
            expect(actualResult).toBe(expectedResult);
          }
        ),
        { numRuns: 50 }
      );
    });

    it("空 AND 组应返回 true（空集的全称量化为真）", () => {
      fc.assert(
        fc.property(arbStock, (stock) => {
          const group = FilterGroup.create(LogicalOperator.AND, [], []);
          const result = group.match(stock, calcService);
          expect(result).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it("空 OR 组应返回 false（空集的存在量化为假）", () => {
      fc.assert(
        fc.property(arbStock, (stock) => {
          const group = FilterGroup.create(LogicalOperator.OR, [], []);
          const result = group.match(stock, calcService);
          expect(result).toBe(false);
        }),
        { numRuns: 50 }
      );
    });

    it("双重否定应等价于原条件", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbStock,
          (condition, stock) => {
            // 创建 NOT(NOT(condition))
            const innerNot = FilterGroup.create(LogicalOperator.NOT, [condition], []);
            const outerNot = FilterGroup.create(LogicalOperator.NOT, [], [innerNot]);
            
            // 评估原条件
            const conditionResult = condition.evaluate(stock, calcService);
            
            // 验证双重否定等价于原条件
            const doubleNotResult = outerNot.match(stock, calcService);
            
            expect(doubleNotResult).toBe(conditionResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("德摩根定律：NOT(A AND B) 等价于 (NOT A) OR (NOT B)", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbValidFilterCondition,
          arbStock,
          (conditionA, conditionB, stock) => {
            // 创建 NOT(A AND B)
            const andGroup = FilterGroup.create(LogicalOperator.AND, [conditionA, conditionB], []);
            const notAnd = FilterGroup.create(LogicalOperator.NOT, [], [andGroup]);
            
            // 创建 (NOT A) OR (NOT B)
            const notA = FilterGroup.create(LogicalOperator.NOT, [conditionA], []);
            const notB = FilterGroup.create(LogicalOperator.NOT, [conditionB], []);
            const orNotGroup = FilterGroup.create(LogicalOperator.OR, [], [notA, notB]);
            
            // 验证两者结果相同
            const notAndResult = notAnd.match(stock, calcService);
            const orNotResult = orNotGroup.match(stock, calcService);
            
            expect(notAndResult).toBe(orNotResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("德摩根定律：NOT(A OR B) 等价于 (NOT A) AND (NOT B)", () => {
      fc.assert(
        fc.property(
          arbValidFilterCondition,
          arbValidFilterCondition,
          arbStock,
          (conditionA, conditionB, stock) => {
            // 创建 NOT(A OR B)
            const orGroup = FilterGroup.create(LogicalOperator.OR, [conditionA, conditionB], []);
            const notOr = FilterGroup.create(LogicalOperator.NOT, [], [orGroup]);
            
            // 创建 (NOT A) AND (NOT B)
            const notA = FilterGroup.create(LogicalOperator.NOT, [conditionA], []);
            const notB = FilterGroup.create(LogicalOperator.NOT, [conditionB], []);
            const andNotGroup = FilterGroup.create(LogicalOperator.AND, [], [notA, notB]);
            
            // 验证两者结果相同
            const notOrResult = notOr.match(stock, calcService);
            const andNotResult = andNotGroup.match(stock, calcService);
            
            expect(notOrResult).toBe(andNotResult);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * 手动递归评估 FilterGroup（用于验证实现的正确性）
 */
function manuallyEvaluateGroup(
  group: FilterGroup,
  stock: Stock,
  calcService: MockIndicatorCalculationService
): boolean {
  // 评估所有直接条件
  const conditionResults = group.conditions.map(c => c.evaluate(stock, calcService));
  
  // 递归评估所有子组
  const subGroupResults = group.subGroups.map(sg => manuallyEvaluateGroup(sg, stock, calcService));
  
  // 合并所有结果
  const allResults = [...conditionResults, ...subGroupResults];
  
  // 根据运算符计算结果
  switch (group.operator) {
    case LogicalOperator.AND:
      return allResults.length === 0 ? true : allResults.every(r => r);
    case LogicalOperator.OR:
      return allResults.length === 0 ? false : allResults.some(r => r);
    case LogicalOperator.NOT:
      return allResults.length === 1 ? !allResults[0] : false;
    default:
      return false;
  }
}

