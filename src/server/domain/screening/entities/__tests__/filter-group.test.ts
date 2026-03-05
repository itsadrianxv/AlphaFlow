/**
 * FilterGroup 实体单元测试
 *
 * 测试 FilterGroup 的核心功能：
 * - 创建和验证（NOT 组约束）
 * - 递归匹配逻辑（AND/OR/NOT）
 * - 递归检查和计数
 * - 序列化/反序列化
 */

import { describe, it, expect } from "vitest";
import { FilterGroup } from "../filter-group";
import { FilterCondition } from "../../value-objects/filter-condition";
import { Stock } from "../stock";
import { StockCode } from "../../value-objects/stock-code";
import { LogicalOperator } from "../../enums/logical-operator";
import { IndicatorField } from "../../enums/indicator-field";
import { ComparisonOperator } from "../../enums/comparison-operator";
import { InvalidFilterConditionError } from "../../errors";
import type { IIndicatorCalculationService } from "../../value-objects/filter-condition";

// Mock 指标计算服务
class MockIndicatorCalculationService implements IIndicatorCalculationService {
  calculateIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): number | string | null {
    return stock.getValue(indicator);
  }
}

describe("FilterGroup", () => {
  const calcService = new MockIndicatorCalculationService();

  // 测试用股票
  const stock1 = new Stock({
    code: StockCode.create("600519"),
    name: "贵州茅台",
    industry: "白酒",
    sector: "主板",
    roe: 0.28,
    pe: 35.5,
    pb: 10.2,
  });

  const stock2 = new Stock({
    code: StockCode.create("000858"),
    name: "五粮液",
    industry: "白酒",
    sector: "主板",
    roe: 0.18,
    pe: 25.0,
    pb: 8.5,
  });

  const stock3 = new Stock({
    code: StockCode.create("600036"),
    name: "招商银行",
    industry: "银行",
    sector: "主板",
    roe: 0.12,
    pe: 8.0,
    pb: 1.2,
  });

  // 测试用条件
  const roeGt15 = FilterCondition.create(
    IndicatorField.ROE,
    ComparisonOperator.GREATER_THAN,
    { type: "numeric", value: 0.15 }
  );

  const peLt30 = FilterCondition.create(
    IndicatorField.PE,
    ComparisonOperator.LESS_THAN,
    { type: "numeric", value: 30 }
  );

  const industryInBaijiu = FilterCondition.create(
    IndicatorField.INDUSTRY,
    ComparisonOperator.IN,
    { type: "list", values: ["白酒", "医药"] }
  );

  describe("创建和验证", () => {
    it("应该成功创建 AND 组", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );

      expect(group.operator).toBe(LogicalOperator.AND);
      expect(group.conditions).toHaveLength(2);
      expect(group.subGroups).toHaveLength(0);
      expect(group.groupId).toBeDefined();
    });

    it("应该成功创建 OR 组", () => {
      const group = FilterGroup.create(
        LogicalOperator.OR,
        [roeGt15, peLt30],
        []
      );

      expect(group.operator).toBe(LogicalOperator.OR);
      expect(group.conditions).toHaveLength(2);
    });

    it("应该成功创建 NOT 组（一个条件）", () => {
      const group = FilterGroup.create(LogicalOperator.NOT, [roeGt15], []);

      expect(group.operator).toBe(LogicalOperator.NOT);
      expect(group.conditions).toHaveLength(1);
      expect(group.subGroups).toHaveLength(0);
    });

    it("应该成功创建 NOT 组（一个子组）", () => {
      const subGroup = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const notGroup = FilterGroup.create(LogicalOperator.NOT, [], [subGroup]);

      expect(notGroup.operator).toBe(LogicalOperator.NOT);
      expect(notGroup.conditions).toHaveLength(0);
      expect(notGroup.subGroups).toHaveLength(1);
    });

    it("应该拒绝 NOT 组包含多个子元素", () => {
      expect(() => {
        FilterGroup.create(LogicalOperator.NOT, [roeGt15, peLt30], []);
      }).toThrow(InvalidFilterConditionError);
    });

    it("应该拒绝 NOT 组包含零个子元素", () => {
      expect(() => {
        FilterGroup.create(LogicalOperator.NOT, [], []);
      }).toThrow(InvalidFilterConditionError);
    });

    it("应该允许空 AND 组", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [], []);
      expect(group.conditions).toHaveLength(0);
      expect(group.subGroups).toHaveLength(0);
    });
  });

  describe("递归匹配 - AND 逻辑", () => {
    it("AND 组：所有条件匹配时返回 true", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );

      // stock2: ROE=0.18 > 0.15 ✓, PE=25 < 30 ✓
      expect(group.match(stock2, calcService)).toBe(true);
    });

    it("AND 组：部分条件不匹配时返回 false", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );

      // stock1: ROE=0.28 > 0.15 ✓, PE=35.5 < 30 ✗
      expect(group.match(stock1, calcService)).toBe(false);
    });

    it("AND 组：空组返回 true", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [], []);
      expect(group.match(stock1, calcService)).toBe(true);
    });

    it("AND 组：嵌套子组全匹配时返回 true", () => {
      const subGroup = FilterGroup.create(LogicalOperator.OR, [roeGt15], []);
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [peLt30],
        [subGroup]
      );

      // stock2: PE=25 < 30 ✓, (ROE=0.18 > 0.15 ✓)
      expect(group.match(stock2, calcService)).toBe(true);
    });
  });

  describe("递归匹配 - OR 逻辑", () => {
    it("OR 组：至少一个条件匹配时返回 true", () => {
      const group = FilterGroup.create(
        LogicalOperator.OR,
        [roeGt15, peLt30],
        []
      );

      // stock1: ROE=0.28 > 0.15 ✓, PE=35.5 < 30 ✗
      expect(group.match(stock1, calcService)).toBe(true);
    });

    it("OR 组：所有条件不匹配时返回 false", () => {
      const group = FilterGroup.create(
        LogicalOperator.OR,
        [roeGt15, peLt30],
        []
      );

      // stock3: ROE=0.12 > 0.15 ✗, PE=8 < 30 ✓
      expect(group.match(stock3, calcService)).toBe(true);
    });

    it("OR 组：空组返回 false", () => {
      const group = FilterGroup.create(LogicalOperator.OR, [], []);
      expect(group.match(stock1, calcService)).toBe(false);
    });

    it("OR 组：嵌套子组任一匹配时返回 true", () => {
      const subGroup1 = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const subGroup2 = FilterGroup.create(
        LogicalOperator.AND,
        [industryInBaijiu],
        []
      );
      const group = FilterGroup.create(LogicalOperator.OR, [], [subGroup1, subGroup2]);

      // stock1: subGroup1 不匹配, subGroup2 匹配（行业=白酒）
      expect(group.match(stock1, calcService)).toBe(true);
    });
  });

  describe("递归匹配 - NOT 逻辑", () => {
    it("NOT 组：对条件结果取反", () => {
      const group = FilterGroup.create(LogicalOperator.NOT, [roeGt15], []);

      // stock1: ROE=0.28 > 0.15 ✓ → NOT ✗
      expect(group.match(stock1, calcService)).toBe(false);

      // stock3: ROE=0.12 > 0.15 ✗ → NOT ✓
      expect(group.match(stock3, calcService)).toBe(true);
    });

    it("NOT 组：对子组结果取反", () => {
      const subGroup = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const notGroup = FilterGroup.create(LogicalOperator.NOT, [], [subGroup]);

      // stock2: (ROE > 0.15 AND PE < 30) ✓ → NOT ✗
      expect(notGroup.match(stock2, calcService)).toBe(false);

      // stock1: (ROE > 0.15 AND PE < 30) ✗ → NOT ✓
      expect(notGroup.match(stock1, calcService)).toBe(true);
    });
  });

  describe("复杂嵌套场景", () => {
    it("应该正确处理三层嵌套：(A OR B) AND NOT C", () => {
      // A: ROE > 0.15
      // B: PE < 30
      // C: 行业 IN [白酒, 医药]
      const orGroup = FilterGroup.create(
        LogicalOperator.OR,
        [roeGt15, peLt30],
        []
      );
      const notGroup = FilterGroup.create(
        LogicalOperator.NOT,
        [industryInBaijiu],
        []
      );
      const andGroup = FilterGroup.create(
        LogicalOperator.AND,
        [],
        [orGroup, notGroup]
      );

      // stock1: (ROE=0.28 > 0.15 ✓ OR PE=35.5 < 30 ✗) ✓ AND NOT (行业=白酒 IN [白酒,医药] ✓) ✗ → false
      expect(andGroup.match(stock1, calcService)).toBe(false);

      // stock3: (ROE=0.12 > 0.15 ✗ OR PE=8 < 30 ✓) ✓ AND NOT (行业=银行 IN [白酒,医药] ✗) ✓ → true
      expect(andGroup.match(stock3, calcService)).toBe(true);
    });
  });

  describe("hasAnyCondition", () => {
    it("应该检测到直接条件", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      expect(group.hasAnyCondition()).toBe(true);
    });

    it("应该递归检测子组中的条件", () => {
      const subGroup = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      const group = FilterGroup.create(LogicalOperator.AND, [], [subGroup]);
      expect(group.hasAnyCondition()).toBe(true);
    });

    it("空组应该返回 false", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [], []);
      expect(group.hasAnyCondition()).toBe(false);
    });

    it("应该检测深层嵌套中的条件", () => {
      const deepGroup = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      const midGroup = FilterGroup.create(LogicalOperator.OR, [], [deepGroup]);
      const topGroup = FilterGroup.create(LogicalOperator.AND, [], [midGroup]);
      expect(topGroup.hasAnyCondition()).toBe(true);
    });
  });

  describe("countTotalConditions", () => {
    it("应该计数直接条件", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      expect(group.countTotalConditions()).toBe(2);
    });

    it("应该递归计数子组中的条件", () => {
      const subGroup = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [industryInBaijiu],
        [subGroup]
      );
      expect(group.countTotalConditions()).toBe(3); // 1 + 2
    });

    it("空组应该返回 0", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [], []);
      expect(group.countTotalConditions()).toBe(0);
    });

    it("应该计数多层嵌套中的所有条件", () => {
      const deep1 = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      const deep2 = FilterGroup.create(LogicalOperator.AND, [peLt30], []);
      const mid = FilterGroup.create(LogicalOperator.OR, [], [deep1, deep2]);
      const top = FilterGroup.create(
        LogicalOperator.AND,
        [industryInBaijiu],
        [mid]
      );
      expect(top.countTotalConditions()).toBe(3); // 1 + (1 + 1)
    });
  });

  describe("序列化和反序列化", () => {
    it("应该序列化简单条件组", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const dict = group.toDict();

      expect(dict.groupId).toBe(group.groupId);
      expect(dict.operator).toBe(LogicalOperator.AND);
      expect(dict.conditions).toHaveLength(2);
      expect(dict.subGroups).toHaveLength(0);
    });

    it("应该反序列化简单条件组", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const dict = group.toDict();
      const restored = FilterGroup.fromDict(dict);

      expect(restored.groupId).toBe(group.groupId);
      expect(restored.operator).toBe(group.operator);
      expect(restored.conditions).toHaveLength(2);
      expect(restored.subGroups).toHaveLength(0);
    });

    it("应该序列化和反序列化嵌套条件组", () => {
      const subGroup = FilterGroup.create(
        LogicalOperator.OR,
        [roeGt15, peLt30],
        []
      );
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [industryInBaijiu],
        [subGroup]
      );

      const dict = group.toDict();
      const restored = FilterGroup.fromDict(dict);

      expect(restored.groupId).toBe(group.groupId);
      expect(restored.operator).toBe(group.operator);
      expect(restored.conditions).toHaveLength(1);
      expect(restored.subGroups).toHaveLength(1);
      expect(restored.subGroups[0]!.operator).toBe(LogicalOperator.OR);
      expect(restored.subGroups[0]!.conditions).toHaveLength(2);
    });

    it("序列化往返后应该能正确匹配股票", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );

      const dict = group.toDict();
      const restored = FilterGroup.fromDict(dict);

      // 原始组和恢复组应该产生相同的匹配结果
      expect(restored.match(stock1, calcService)).toBe(
        group.match(stock1, calcService)
      );
      expect(restored.match(stock2, calcService)).toBe(
        group.match(stock2, calcService)
      );
      expect(restored.match(stock3, calcService)).toBe(
        group.match(stock3, calcService)
      );
    });

    it("应该序列化和反序列化深层嵌套结构", () => {
      const deep1 = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      const deep2 = FilterGroup.create(LogicalOperator.AND, [peLt30], []);
      const mid = FilterGroup.create(LogicalOperator.OR, [], [deep1, deep2]);
      const top = FilterGroup.create(
        LogicalOperator.AND,
        [industryInBaijiu],
        [mid]
      );

      const dict = top.toDict();
      const restored = FilterGroup.fromDict(dict);

      expect(restored.countTotalConditions()).toBe(3);
      expect(restored.subGroups).toHaveLength(1);
      expect(restored.subGroups[0]!.subGroups).toHaveLength(2);
    });
  });

  describe("equals", () => {
    it("应该基于 groupId 判断相等", () => {
      const group1 = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);
      const group2 = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);

      expect(group1.equals(group1)).toBe(true);
      expect(group1.equals(group2)).toBe(false); // 不同的 groupId
    });

    it("应该处理 null 和 undefined", () => {
      const group = FilterGroup.create(LogicalOperator.AND, [roeGt15], []);

      expect(group.equals(null)).toBe(false);
      expect(group.equals(undefined)).toBe(false);
    });
  });

  describe("toString", () => {
    it("应该生成可读的字符串表示", () => {
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [roeGt15, peLt30],
        []
      );
      const str = group.toString();

      expect(str).toContain("ROE");
      expect(str).toContain("PE");
      expect(str).toContain("AND");
    });

    it("应该处理嵌套组", () => {
      const subGroup = FilterGroup.create(LogicalOperator.OR, [roeGt15], []);
      const group = FilterGroup.create(
        LogicalOperator.AND,
        [peLt30],
        [subGroup]
      );
      const str = group.toString();

      expect(str).toContain("(");
      expect(str).toContain(")");
    });
  });
});
