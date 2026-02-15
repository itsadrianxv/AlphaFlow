/**
 * FilterCondition 值对象单元测试
 *
 * 测试覆盖：
 * - 构造时的类型验证
 * - 构造时的运算符兼容性验证
 * - evaluate 方法的各种场景
 * - null 值处理
 * - 序列化/反序列化
 */

import { describe, it, expect } from "vitest";
import { FilterCondition } from "../filter-condition";
import { IndicatorField, getIndicatorValueType, IndicatorValueType } from "../../enums/indicator-field";
import { ComparisonOperator } from "../../enums/comparison-operator";
import { Stock } from "../../entities/stock";
import { StockCode } from "../stock-code";
import { InvalidFilterConditionError } from "../../errors";
import type { IIndicatorCalculationService } from "../filter-condition";
import type { IndicatorValue } from "../indicator-value";

// Mock 指标计算服务
class MockIndicatorCalculationService implements IIndicatorCalculationService {
  private mockValues: Map<string, number | string | null> = new Map();

  setMockValue(
    indicator: IndicatorField,
    stockCode: string,
    value: number | string | null
  ): void {
    this.mockValues.set(`${indicator}-${stockCode}`, value);
  }

  calculateIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): number | string | null {
    const key = `${indicator}-${stock.code.value}`;
    // 如果有 mock 值（包括 null），直接返回 mock 值
    if (this.mockValues.has(key)) {
      return this.mockValues.get(key) ?? null;
    }
    // 否则返回 stock 的实际值
    return stock.getValue(indicator);
  }
}

describe("FilterCondition", () => {
  describe("构造验证", () => {
    describe("类型匹配验证 (Requirements: 2.2)", () => {
      it("应接受数值型指标 + numeric 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.ROE, ComparisonOperator.GREATER_THAN, {
            type: "numeric",
            value: 0.15,
          })
        ).not.toThrow();
      });

      it("应接受数值型指标 + range 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.PE, ComparisonOperator.BETWEEN, {
            type: "range",
            min: 10,
            max: 30,
          })
        ).not.toThrow();
      });

      it("应接受数值型指标 + timeSeries 值", () => {
        expect(() =>
          FilterCondition.create(
            IndicatorField.REVENUE_CAGR_3Y,
            ComparisonOperator.GREATER_THAN,
            {
              type: "timeSeries",
              years: 3,
            }
          )
        ).not.toThrow();
      });

      it("应接受文本型指标 + text 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.EQUAL, {
            type: "text",
            value: "白酒",
          })
        ).not.toThrow();
      });

      it("应接受文本型指标 + list 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.IN, {
            type: "list",
            values: ["白酒", "医药"],
          })
        ).not.toThrow();
      });

      it("应拒绝数值型指标 + text 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.ROE, ComparisonOperator.EQUAL, {
            type: "text",
            value: "高",
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("应拒绝文本型指标 + numeric 值", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.EQUAL, {
            type: "numeric",
            value: 100,
          })
        ).toThrow(InvalidFilterConditionError);
      });
    });

    describe("运算符兼容性验证 (Requirements: 2.3)", () => {
      it("GREATER_THAN 应仅适用于 numeric", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.ROE, ComparisonOperator.GREATER_THAN, {
            type: "numeric",
            value: 0.15,
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.GREATER_THAN, {
            type: "text",
            value: "白酒",
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("LESS_THAN 应仅适用于 numeric", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.PE, ComparisonOperator.LESS_THAN, {
            type: "numeric",
            value: 30,
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.LESS_THAN, {
            type: "list",
            values: ["白酒"],
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("EQUAL 应适用于 numeric 和 text", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.ROE, ComparisonOperator.EQUAL, {
            type: "numeric",
            value: 0.15,
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.EQUAL, {
            type: "text",
            value: "白酒",
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.EQUAL, {
            type: "list",
            values: ["白酒"],
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("IN/NOT_IN 应仅适用于 list", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.IN, {
            type: "list",
            values: ["白酒", "医药"],
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.IN, {
            type: "text",
            value: "白酒",
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("BETWEEN 应仅适用于 range", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.PE, ComparisonOperator.BETWEEN, {
            type: "range",
            min: 10,
            max: 30,
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.PE, ComparisonOperator.BETWEEN, {
            type: "numeric",
            value: 20,
          })
        ).toThrow(InvalidFilterConditionError);
      });

      it("CONTAINS 应仅适用于 text", () => {
        expect(() =>
          FilterCondition.create(IndicatorField.INDUSTRY, ComparisonOperator.CONTAINS, {
            type: "text",
            value: "酒",
          })
        ).not.toThrow();

        expect(() =>
          FilterCondition.create(IndicatorField.ROE, ComparisonOperator.CONTAINS, {
            type: "numeric",
            value: 0.15,
          })
        ).toThrow(InvalidFilterConditionError);
      });
    });
  });

  describe("evaluate 方法", () => {
    const calcService = new MockIndicatorCalculationService();

    const createTestStock = (code: string, roe?: number, industry?: string): Stock => {
      return new Stock({
        code: StockCode.create(code),
        name: "测试股票",
        industry: industry ?? "未知",
        sector: "主板",
        roe: roe ?? null,
      });
    };

    describe("null 值处理 (Requirements: 3.3)", () => {
      it("当指标值为 null 时应返回 false", () => {
        const condition = FilterCondition.create(
          IndicatorField.ROE,
          ComparisonOperator.GREATER_THAN,
          { type: "numeric", value: 0.15 }
        );

        const stock = createTestStock("600519", undefined); // ROE 为 null
        expect(condition.evaluate(stock, calcService)).toBe(false);
      });

      it("当计算服务返回 null 时应返回 false", () => {
        const condition = FilterCondition.create(
          IndicatorField.REVENUE_CAGR_3Y,
          ComparisonOperator.GREATER_THAN,
          { type: "numeric", value: 0.1 }
        );

        const stock = createTestStock("600519", 0.28);
        calcService.setMockValue(IndicatorField.REVENUE_CAGR_3Y, "600519", null);

        expect(condition.evaluate(stock, calcService)).toBe(false);
      });
    });

    describe("数值比较", () => {
      it("GREATER_THAN: 应正确比较大于", () => {
        const condition = FilterCondition.create(
          IndicatorField.ROE,
          ComparisonOperator.GREATER_THAN,
          { type: "numeric", value: 0.15 }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28), calcService)).toBe(true);
        expect(condition.evaluate(createTestStock("600519", 0.15), calcService)).toBe(false);
        expect(condition.evaluate(createTestStock("600519", 0.10), calcService)).toBe(false);
      });

      it("LESS_THAN: 应正确比较小于", () => {
        const condition = FilterCondition.create(
          IndicatorField.PE,
          ComparisonOperator.LESS_THAN,
          { type: "numeric", value: 30 }
        );

        const stock1 = new Stock({
          code: StockCode.create("600519"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 25,
        });

        const stock2 = new Stock({
          code: StockCode.create("600520"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 35,
        });

        expect(condition.evaluate(stock1, calcService)).toBe(true);
        expect(condition.evaluate(stock2, calcService)).toBe(false);
      });

      it("EQUAL: 应正确比较相等", () => {
        const condition = FilterCondition.create(
          IndicatorField.ROE,
          ComparisonOperator.EQUAL,
          { type: "numeric", value: 0.28 }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28), calcService)).toBe(true);
        expect(condition.evaluate(createTestStock("600519", 0.27), calcService)).toBe(false);
      });

      it("BETWEEN: 应正确比较区间", () => {
        const condition = FilterCondition.create(
          IndicatorField.PE,
          ComparisonOperator.BETWEEN,
          { type: "range", min: 10, max: 30 }
        );

        const stock1 = new Stock({
          code: StockCode.create("600519"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 20,
        });

        const stock2 = new Stock({
          code: StockCode.create("600520"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 10,
        });

        const stock3 = new Stock({
          code: StockCode.create("600521"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 30,
        });

        const stock4 = new Stock({
          code: StockCode.create("600522"),
          name: "测试",
          industry: "白酒",
          sector: "主板",
          pe: 35,
        });

        expect(condition.evaluate(stock1, calcService)).toBe(true);
        expect(condition.evaluate(stock2, calcService)).toBe(true); // 边界值
        expect(condition.evaluate(stock3, calcService)).toBe(true); // 边界值
        expect(condition.evaluate(stock4, calcService)).toBe(false);
      });
    });

    describe("文本比较", () => {
      it("EQUAL: 应正确比较文本相等", () => {
        const condition = FilterCondition.create(
          IndicatorField.INDUSTRY,
          ComparisonOperator.EQUAL,
          { type: "text", value: "白酒" }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28, "白酒"), calcService)).toBe(
          true
        );
        expect(condition.evaluate(createTestStock("600519", 0.28, "医药"), calcService)).toBe(
          false
        );
      });

      it("NOT_EQUAL: 应正确比较文本不等", () => {
        const condition = FilterCondition.create(
          IndicatorField.INDUSTRY,
          ComparisonOperator.NOT_EQUAL,
          { type: "text", value: "白酒" }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28, "医药"), calcService)).toBe(
          true
        );
        expect(condition.evaluate(createTestStock("600519", 0.28, "白酒"), calcService)).toBe(
          false
        );
      });

      it("IN: 应正确判断包含于列表", () => {
        const condition = FilterCondition.create(
          IndicatorField.INDUSTRY,
          ComparisonOperator.IN,
          { type: "list", values: ["白酒", "医药", "科技"] }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28, "白酒"), calcService)).toBe(
          true
        );
        expect(condition.evaluate(createTestStock("600519", 0.28, "医药"), calcService)).toBe(
          true
        );
        expect(condition.evaluate(createTestStock("600519", 0.28, "银行"), calcService)).toBe(
          false
        );
      });

      it("NOT_IN: 应正确判断不包含于列表", () => {
        const condition = FilterCondition.create(
          IndicatorField.INDUSTRY,
          ComparisonOperator.NOT_IN,
          { type: "list", values: ["白酒", "医药"] }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28, "科技"), calcService)).toBe(
          true
        );
        expect(condition.evaluate(createTestStock("600519", 0.28, "白酒"), calcService)).toBe(
          false
        );
      });

      it("CONTAINS: 应正确判断包含子串", () => {
        const condition = FilterCondition.create(
          IndicatorField.INDUSTRY,
          ComparisonOperator.CONTAINS,
          { type: "text", value: "酒" }
        );

        expect(condition.evaluate(createTestStock("600519", 0.28, "白酒"), calcService)).toBe(
          true
        );
        expect(
          condition.evaluate(createTestStock("600519", 0.28, "啤酒饮料"), calcService)
        ).toBe(true);
        expect(condition.evaluate(createTestStock("600519", 0.28, "医药"), calcService)).toBe(
          false
        );
      });
    });
  });

  describe("序列化 (Requirements: 2.6)", () => {
    it("应正确序列化和反序列化数值条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15, unit: "%" }
      );

      const dict = condition.toDict();
      const restored = FilterCondition.fromDict(dict);

      expect(restored.field).toBe(condition.field);
      expect(restored.operator).toBe(condition.operator);
      expect(restored.equals(condition)).toBe(true);
    });

    it("应正确序列化和反序列化文本条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.INDUSTRY,
        ComparisonOperator.EQUAL,
        { type: "text", value: "白酒" }
      );

      const dict = condition.toDict();
      const restored = FilterCondition.fromDict(dict);

      expect(restored.equals(condition)).toBe(true);
    });

    it("应正确序列化和反序列化列表条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.INDUSTRY,
        ComparisonOperator.IN,
        { type: "list", values: ["白酒", "医药", "科技"] }
      );

      const dict = condition.toDict();
      const restored = FilterCondition.fromDict(dict);

      expect(restored.equals(condition)).toBe(true);
    });

    it("应正确序列化和反序列化范围条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.PE,
        ComparisonOperator.BETWEEN,
        { type: "range", min: 10, max: 30 }
      );

      const dict = condition.toDict();
      const restored = FilterCondition.fromDict(dict);

      expect(restored.equals(condition)).toBe(true);
    });
  });

  describe("equals 方法", () => {
    it("相同内容的条件应相等", () => {
      const condition1 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      const condition2 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      expect(condition1.equals(condition2)).toBe(true);
    });

    it("不同字段的条件应不相等", () => {
      const condition1 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      const condition2 = FilterCondition.create(
        IndicatorField.PE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      expect(condition1.equals(condition2)).toBe(false);
    });

    it("不同运算符的条件应不相等", () => {
      const condition1 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      const condition2 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.LESS_THAN,
        { type: "numeric", value: 0.15 }
      );

      expect(condition1.equals(condition2)).toBe(false);
    });

    it("不同值的条件应不相等", () => {
      const condition1 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      );

      const condition2 = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.20 }
      );

      expect(condition1.equals(condition2)).toBe(false);
    });
  });

  describe("toString 方法", () => {
    it("应正确格式化数值条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15, unit: "%" }
      );

      expect(condition.toString()).toBe("ROE GREATER_THAN 0.15%");
    });

    it("应正确格式化文本条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.INDUSTRY,
        ComparisonOperator.EQUAL,
        { type: "text", value: "白酒" }
      );

      expect(condition.toString()).toBe('INDUSTRY EQUAL "白酒"');
    });

    it("应正确格式化列表条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.INDUSTRY,
        ComparisonOperator.IN,
        { type: "list", values: ["白酒", "医药"] }
      );

      expect(condition.toString()).toBe("INDUSTRY IN [白酒, 医药]");
    });

    it("应正确格式化范围条件", () => {
      const condition = FilterCondition.create(
        IndicatorField.PE,
        ComparisonOperator.BETWEEN,
        { type: "range", min: 10, max: 30 }
      );

      expect(condition.toString()).toBe("PE BETWEEN [10, 30]");
    });
  });
});

/**
 * Property-Based Tests for FilterCondition
 *
 * Feature: stock-screening-platform
 * Property 3: FilterCondition 构造验证
 *
 * 验证 FilterCondition 构造成功当且仅当：
 * (a) field 的 valueType 与 value 的类型匹配
 * (b) operator 与 value 类型兼容
 *
 * **Validates: Requirements 2.2, 2.3**
 */

import * as fc from "fast-check";

describe("Property-Based Tests: FilterCondition 构造验证", () => {
  /**
   * 生成器：数值型指标字段
   */
  const arbNumericIndicatorField = fc.constantFrom(
    IndicatorField.ROE,
    IndicatorField.PE,
    IndicatorField.PB,
    IndicatorField.EPS,
    IndicatorField.REVENUE,
    IndicatorField.NET_PROFIT,
    IndicatorField.DEBT_RATIO,
    IndicatorField.MARKET_CAP,
    IndicatorField.FLOAT_MARKET_CAP,
    IndicatorField.REVENUE_CAGR_3Y,
    IndicatorField.NET_PROFIT_CAGR_3Y,
    IndicatorField.ROE_AVG_3Y,
    IndicatorField.PEG,
    IndicatorField.ROE_MINUS_DEBT
  );

  /**
   * 生成器：文本型指标字段
   */
  const arbTextIndicatorField = fc.constantFrom(
    IndicatorField.INDUSTRY,
    IndicatorField.SECTOR
  );

  /**
   * 生成器：NumericValue
   */
  const arbNumericValue = fc.record({
    type: fc.constant("numeric" as const),
    value: fc.double({ min: -1000, max: 10000, noNaN: true }),
    unit: fc.option(fc.constantFrom("%", "元", "亿元"), { nil: undefined }),
  });

  /**
   * 生成器：TextValue
   */
  const arbTextValue = fc.record({
    type: fc.constant("text" as const),
    value: fc.string({ minLength: 1, maxLength: 20 }),
  });

  /**
   * 生成器：ListValue
   */
  const arbListValue = fc.record({
    type: fc.constant("list" as const),
    values: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
      minLength: 1,
      maxLength: 5,
    }),
  });

  /**
   * 生成器：RangeValue
   */
  const arbRangeValue = fc
    .tuple(
      fc.double({ min: -1000, max: 10000, noNaN: true }),
      fc.double({ min: -1000, max: 10000, noNaN: true })
    )
    .map(([a, b]) => ({
      type: "range" as const,
      min: Math.min(a, b),
      max: Math.max(a, b),
    }));

  /**
   * 生成器：TimeSeriesValue
   */
  const arbTimeSeriesValue = fc.record({
    type: fc.constant("timeSeries" as const),
    years: fc.constantFrom(1, 3, 5),
    threshold: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
      nil: undefined,
    }),
  });

  /**
   * 生成器：所有 ComparisonOperator
   */
  const arbComparisonOperator = fc.constantFrom(
    ComparisonOperator.GREATER_THAN,
    ComparisonOperator.LESS_THAN,
    ComparisonOperator.EQUAL,
    ComparisonOperator.NOT_EQUAL,
    ComparisonOperator.IN,
    ComparisonOperator.NOT_IN,
    ComparisonOperator.BETWEEN,
    ComparisonOperator.CONTAINS
  );

  /**
   * 辅助函数：判断类型是否匹配
   */
  function isTypeMatch(field: IndicatorField, value: IndicatorValue): boolean {
    const fieldValueType = getIndicatorValueType(field);

    if (fieldValueType === IndicatorValueType.NUMERIC) {
      return (
        value.type === "numeric" ||
        value.type === "range" ||
        value.type === "timeSeries"
      );
    } else {
      // TEXT
      return value.type === "text" || value.type === "list";
    }
  }

  /**
   * 辅助函数：判断运算符是否兼容
   */
  function isOperatorCompatible(
    operator: ComparisonOperator,
    value: IndicatorValue
  ): boolean {
    switch (operator) {
      case ComparisonOperator.GREATER_THAN:
      case ComparisonOperator.LESS_THAN:
        return value.type === "numeric" || value.type === "timeSeries";

      case ComparisonOperator.EQUAL:
      case ComparisonOperator.NOT_EQUAL:
        return value.type === "numeric" || value.type === "text";

      case ComparisonOperator.IN:
      case ComparisonOperator.NOT_IN:
        return value.type === "list";

      case ComparisonOperator.BETWEEN:
        return value.type === "range";

      case ComparisonOperator.CONTAINS:
        return value.type === "text";

      default:
        return false;
    }
  }

  /**
   * Property 3: FilterCondition 构造验证
   *
   * 对于任意 IndicatorField、ComparisonOperator 和 IndicatorValue 的组合，
   * FilterCondition 的构造应当且仅当满足以下条件时成功：
   * (a) field 的 valueType 与 value 的类型匹配
   * (b) operator 与 value 类型兼容
   *
   * **Validates: Requirements 2.2, 2.3**
   */
  it("Property 3: 构造成功当且仅当类型匹配且运算符兼容", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbNumericIndicatorField, arbTextIndicatorField),
        arbComparisonOperator,
        fc.oneof(
          arbNumericValue,
          arbTextValue,
          arbListValue,
          arbRangeValue,
          arbTimeSeriesValue
        ),
        (field, operator, value) => {
          const typeMatches = isTypeMatch(field, value);
          const operatorCompatible = isOperatorCompatible(operator, value);
          const shouldSucceed = typeMatches && operatorCompatible;

          if (shouldSucceed) {
            // 应该构造成功
            expect(() => FilterCondition.create(field, operator, value)).not.toThrow();
          } else {
            // 应该抛出 InvalidFilterConditionError
            expect(() => FilterCondition.create(field, operator, value)).toThrow(
              InvalidFilterConditionError
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3.1: 有效组合应构造成功
   *
   * 生成已知有效的组合，验证构造成功
   */
  it("Property 3.1: 有效组合应构造成功", () => {
    // 数值型指标 + numeric + 数值比较运算符
    const arbValidNumericComparison = fc
      .tuple(
        arbNumericIndicatorField,
        fc.constantFrom(
          ComparisonOperator.GREATER_THAN,
          ComparisonOperator.LESS_THAN,
          ComparisonOperator.EQUAL,
          ComparisonOperator.NOT_EQUAL
        ),
        arbNumericValue
      )
      .map(([field, operator, value]) => ({ field, operator, value }));

    // 数值型指标 + range + BETWEEN
    const arbValidRangeComparison = fc
      .tuple(arbNumericIndicatorField, arbRangeValue)
      .map(([field, value]) => ({
        field,
        operator: ComparisonOperator.BETWEEN,
        value,
      }));

    // 数值型指标 + timeSeries + 数值比较运算符
    const arbValidTimeSeriesComparison = fc
      .tuple(
        arbNumericIndicatorField,
        fc.constantFrom(ComparisonOperator.GREATER_THAN, ComparisonOperator.LESS_THAN),
        arbTimeSeriesValue
      )
      .map(([field, operator, value]) => ({ field, operator, value }));

    // 文本型指标 + text + 文本运算符
    const arbValidTextComparison = fc
      .tuple(
        arbTextIndicatorField,
        fc.constantFrom(
          ComparisonOperator.EQUAL,
          ComparisonOperator.NOT_EQUAL,
          ComparisonOperator.CONTAINS
        ),
        arbTextValue
      )
      .map(([field, operator, value]) => ({ field, operator, value }));

    // 文本型指标 + list + IN/NOT_IN
    const arbValidListComparison = fc
      .tuple(
        arbTextIndicatorField,
        fc.constantFrom(ComparisonOperator.IN, ComparisonOperator.NOT_IN),
        arbListValue
      )
      .map(([field, operator, value]) => ({ field, operator, value }));

    fc.assert(
      fc.property(
        fc.oneof(
          arbValidNumericComparison,
          arbValidRangeComparison,
          arbValidTimeSeriesComparison,
          arbValidTextComparison,
          arbValidListComparison
        ),
        ({ field, operator, value }) => {
          // 所有有效组合都应构造成功
          expect(() => FilterCondition.create(field, operator, value)).not.toThrow();

          // 构造的对象应包含正确的字段
          const condition = FilterCondition.create(field, operator, value);
          expect(condition.field).toBe(field);
          expect(condition.operator).toBe(operator);
          expect(condition.value).toEqual(value);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3.2: 类型不匹配应失败
   *
   * 生成类型不匹配的组合，验证构造失败
   */
  it("Property 3.2: 类型不匹配应失败", () => {
    // 数值型指标 + text 值（类型不匹配）
    const arbNumericFieldTextValue = fc
      .tuple(arbNumericIndicatorField, arbTextValue, arbComparisonOperator)
      .map(([field, value, operator]) => ({ field, value, operator }));

    // 文本型指标 + numeric 值（类型不匹配）
    const arbTextFieldNumericValue = fc
      .tuple(arbTextIndicatorField, arbNumericValue, arbComparisonOperator)
      .map(([field, value, operator]) => ({ field, value, operator }));

    fc.assert(
      fc.property(
        fc.oneof(arbNumericFieldTextValue, arbTextFieldNumericValue),
        ({ field, value, operator }) => {
          // 类型不匹配应抛出错误
          expect(() => FilterCondition.create(field, operator, value)).toThrow(
            InvalidFilterConditionError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3.3: 运算符不兼容应失败
   *
   * 生成运算符不兼容的组合，验证构造失败
   */
  it("Property 3.3: 运算符不兼容应失败", () => {
    // GREATER_THAN + text（运算符不兼容）
    const arbGreaterThanText = fc
      .tuple(arbTextIndicatorField, arbTextValue)
      .map(([field, value]) => ({
        field,
        operator: ComparisonOperator.GREATER_THAN,
        value,
      }));

    // IN + numeric（运算符不兼容）
    const arbInNumeric = fc
      .tuple(arbNumericIndicatorField, arbNumericValue)
      .map(([field, value]) => ({
        field,
        operator: ComparisonOperator.IN,
        value,
      }));

    // BETWEEN + numeric（应该用 range）
    const arbBetweenNumeric = fc
      .tuple(arbNumericIndicatorField, arbNumericValue)
      .map(([field, value]) => ({
        field,
        operator: ComparisonOperator.BETWEEN,
        value,
      }));

    // CONTAINS + numeric（运算符不兼容）
    const arbContainsNumeric = fc
      .tuple(arbNumericIndicatorField, arbNumericValue)
      .map(([field, value]) => ({
        field,
        operator: ComparisonOperator.CONTAINS,
        value,
      }));

    fc.assert(
      fc.property(
        fc.oneof(arbGreaterThanText, arbInNumeric, arbBetweenNumeric, arbContainsNumeric),
        ({ field, operator, value }) => {
          // 运算符不兼容应抛出错误
          expect(() => FilterCondition.create(field, operator, value)).toThrow(
            InvalidFilterConditionError
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-Based Tests for Missing Indicator Values
 *
 * Feature: stock-screening-platform
 * Property 7: 缺失指标值导致条件不匹配
 *
 * 对于任意 FilterCondition 和任意 Stock，当 Stock 对应 IndicatorField 的值为 null 时，
 * evaluate 方法应返回 false。
 *
 * **Validates: Requirements 3.3**
 */
describe("Property-Based Tests: 缺失指标值导致条件不匹配", () => {
  const calcService = new MockIndicatorCalculationService();

  /**
   * 生成器：创建指标值为 null 的 Stock
   */
  const arbStockWithNullIndicator = fc
    .tuple(
      fc.constantFrom(
        IndicatorField.ROE,
        IndicatorField.PE,
        IndicatorField.PB,
        IndicatorField.EPS,
        IndicatorField.REVENUE,
        IndicatorField.NET_PROFIT,
        IndicatorField.DEBT_RATIO,
        IndicatorField.MARKET_CAP,
        IndicatorField.FLOAT_MARKET_CAP,
        IndicatorField.INDUSTRY,
        IndicatorField.SECTOR
      ),
      fc.tuple(
        fc.constantFrom("0", "3", "6"),
        fc.integer({ min: 0, max: 99999 })
      ).map(([prefix, num]) => `${prefix}${num.toString().padStart(5, "0")}`),
      fc.string({ minLength: 2, maxLength: 10 })
    )
    .map(([nullField, code, name]) => {
      // 创建一个 Stock，其中 nullField 对应的指标值为 null
      const stockProps: {
        code: StockCode;
        name: string;
        industry: string;
        sector: string;
        roe?: number | null;
        pe?: number | null;
        pb?: number | null;
        eps?: number | null;
        revenue?: number | null;
        netProfit?: number | null;
        debtRatio?: number | null;
        marketCap?: number | null;
        floatMarketCap?: number | null;
      } = {
        code: StockCode.create(code),
        name,
        industry: "测试行业",
        sector: "主板",
      };

      // 根据 nullField 设置对应字段为 null
      switch (nullField) {
        case IndicatorField.ROE:
          stockProps.roe = null;
          break;
        case IndicatorField.PE:
          stockProps.pe = null;
          break;
        case IndicatorField.PB:
          stockProps.pb = null;
          break;
        case IndicatorField.EPS:
          stockProps.eps = null;
          break;
        case IndicatorField.REVENUE:
          stockProps.revenue = null;
          break;
        case IndicatorField.NET_PROFIT:
          stockProps.netProfit = null;
          break;
        case IndicatorField.DEBT_RATIO:
          stockProps.debtRatio = null;
          break;
        case IndicatorField.MARKET_CAP:
          stockProps.marketCap = null;
          break;
        case IndicatorField.FLOAT_MARKET_CAP:
          stockProps.floatMarketCap = null;
          break;
        case IndicatorField.INDUSTRY:
          stockProps.industry = "";
          break;
        case IndicatorField.SECTOR:
          stockProps.sector = "";
          break;
      }

      return { stock: new Stock(stockProps), nullField };
    });

  /**
   * 生成器：为指定字段创建有效的 FilterCondition
   */
  const arbConditionForField = (field: IndicatorField) => {
    const fieldValueType = getIndicatorValueType(field);

    if (fieldValueType === IndicatorValueType.NUMERIC) {
      // 数值型指标：使用 GREATER_THAN 运算符
      return fc
        .double({ min: -1000, max: 10000, noNaN: true })
        .map((value) =>
          FilterCondition.create(field, ComparisonOperator.GREATER_THAN, {
            type: "numeric",
            value,
          })
        );
    } else {
      // 文本型指标：使用 EQUAL 运算符
      return fc
        .string({ minLength: 1, maxLength: 20 })
        .map((value) =>
          FilterCondition.create(field, ComparisonOperator.EQUAL, {
            type: "text",
            value,
          })
        );
    }
  };

  /**
   * Property 7: 缺失指标值导致条件不匹配
   *
   * 对于任意 FilterCondition 和任意 Stock，当 Stock 对应 IndicatorField 的值为 null 时，
   * evaluate 方法应返回 false。
   *
   * **Validates: Requirements 3.3**
   */
  it("Property 7: 缺失指标值应导致 evaluate 返回 false", () => {
    fc.assert(
      fc.property(arbStockWithNullIndicator, ({ stock, nullField }) => {
        // 为 nullField 创建一个有效的 FilterCondition
        return fc.assert(
          fc.property(arbConditionForField(nullField), (condition) => {
            // 验证 evaluate 返回 false
            const result = condition.evaluate(stock, calcService);
            expect(result).toBe(false);
          }),
          { numRuns: 10 }
        );
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.1: 缺失指标值应对所有运算符返回 false
   *
   * 验证无论使用什么运算符，缺失的指标值都应导致 evaluate 返回 false
   */
  it("Property 7.1: 缺失指标值对所有运算符都返回 false", () => {
    // 数值型指标的所有兼容运算符
    const numericOperators = [
      ComparisonOperator.GREATER_THAN,
      ComparisonOperator.LESS_THAN,
      ComparisonOperator.EQUAL,
      ComparisonOperator.NOT_EQUAL,
    ];

    // 文本型指标的所有兼容运算符
    const textOperators = [
      ComparisonOperator.EQUAL,
      ComparisonOperator.NOT_EQUAL,
      ComparisonOperator.CONTAINS,
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(
          IndicatorField.ROE,
          IndicatorField.PE,
          IndicatorField.PB
        ),
        fc.tuple(
          fc.constantFrom("0", "3", "6"),
          fc.integer({ min: 0, max: 99999 })
        ).map(([prefix, num]) => `${prefix}${num.toString().padStart(5, "0")}`),
        (field, code) => {
          const operators = numericOperators;

          // 创建指标值为 null 的 Stock
          const stockProps: {
            code: StockCode;
            name: string;
            industry: string;
            sector: string;
            roe?: number | null;
            pe?: number | null;
            pb?: number | null;
          } = {
            code: StockCode.create(code),
            name: "测试股票",
            industry: "测试行业",
            sector: "主板",
          };

          if (field === IndicatorField.ROE) stockProps.roe = null;
          if (field === IndicatorField.PE) stockProps.pe = null;
          if (field === IndicatorField.PB) stockProps.pb = null;

          const stock = new Stock(stockProps);

          // 对每个运算符测试
          operators.forEach((operator) => {
            const condition = FilterCondition.create(field, operator, {
              type: "numeric",
              value: 0.15,
            });

            // 验证 evaluate 返回 false
            const result = condition.evaluate(stock, calcService);
            expect(result).toBe(false);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7.2: 计算服务返回 null 应导致条件不匹配
   *
   * 验证当 IIndicatorCalculationService 返回 null 时，evaluate 也应返回 false
   */
  it("Property 7.2: 计算服务返回 null 应导致 evaluate 返回 false", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          IndicatorField.ROE,
          IndicatorField.PE,
          IndicatorField.REVENUE_CAGR_3Y,
          IndicatorField.NET_PROFIT_CAGR_3Y
        ),
        fc.tuple(
          fc.constantFrom("0", "3", "6"),
          fc.integer({ min: 0, max: 99999 })
        ).map(([prefix, num]) => `${prefix}${num.toString().padStart(5, "0")}`),
        fc.double({ min: -1000, max: 10000, noNaN: true }),
        (field, code, conditionValue) => {
          // 创建一个新的 mock 服务实例，确保每次测试都是独立的
          const mockCalcService = new MockIndicatorCalculationService();

          // 创建一个有值的 Stock（但计算服务会返回 null）
          const stock = new Stock({
            code: StockCode.create(code),
            name: "测试股票",
            industry: "测试行业",
            sector: "主板",
            roe: 0.28,
            pe: 35.5,
          });

          // 设置计算服务返回 null
          mockCalcService.setMockValue(field, code, null);

          // 创建条件
          const condition = FilterCondition.create(
            field,
            ComparisonOperator.GREATER_THAN,
            { type: "numeric", value: conditionValue }
          );

          // 验证 evaluate 返回 false
          const result = condition.evaluate(stock, mockCalcService);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
