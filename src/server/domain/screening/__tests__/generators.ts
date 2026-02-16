/**
 * fast-check 生成器工具库
 *
 * 提供用于属性基测试的随机数据生成器
 */

import * as fc from "fast-check";
import { IndicatorField, INDICATOR_FIELD_METADATA, IndicatorValueType } from "../enums/indicator-field";
import { ComparisonOperator } from "../enums/comparison-operator";
import { LogicalOperator } from "../enums/logical-operator";
import { FilterCondition } from "../value-objects/filter-condition";
import { FilterGroup } from "../entities/filter-group";
import { ScoringConfig, NormalizationMethod } from "../value-objects/scoring-config";
import type { IndicatorValue } from "../value-objects/indicator-value";
import { Stock } from "../entities/stock";
import { StockCode } from "../value-objects/stock-code";

/**
 * 生成有效的股票代码（6位数字，以0/3/6开头）
 */
export const arbStockCode = fc
  .tuple(
    fc.constantFrom("0", "3", "6"),
    fc.integer({ min: 0, max: 99999 })
  )
  .map(([prefix, num]) => `${prefix}${num.toString().padStart(5, "0")}`);

/**
 * 生成数值型 IndicatorField
 */
export const arbNumericIndicatorField = fc.constantFrom(
  IndicatorField.ROE,
  IndicatorField.PE,
  IndicatorField.PB,
  IndicatorField.EPS,
  IndicatorField.REVENUE,
  IndicatorField.NET_PROFIT,
  IndicatorField.DEBT_RATIO,
  IndicatorField.MARKET_CAP,
  IndicatorField.FLOAT_MARKET_CAP
);

/**
 * 生成文本型 IndicatorField
 */
export const arbTextIndicatorField = fc.constantFrom(
  IndicatorField.INDUSTRY,
  IndicatorField.SECTOR
);

/**
 * 生成任意 IndicatorField
 */
export const arbIndicatorField = fc.oneof(
  arbNumericIndicatorField,
  arbTextIndicatorField
);

/**
 * 生成数值型 IndicatorValue
 */
export const arbNumericValue = fc
  .double({ min: -1000, max: 10000, noNaN: true })
  .map((value): IndicatorValue => ({ type: "numeric", value }));

/**
 * 生成文本型 IndicatorValue
 */
export const arbTextValue = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((value): IndicatorValue => ({ type: "text", value }));

/**
 * 生成列表型 IndicatorValue
 */
export const arbListValue = fc
  .array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 })
  .map((values): IndicatorValue => ({ type: "list", values }));

/**
 * 生成范围型 IndicatorValue
 */
export const arbRangeValue = fc
  .tuple(
    fc.double({ min: -1000, max: 10000, noNaN: true }),
    fc.double({ min: -1000, max: 10000, noNaN: true })
  )
  .map(([a, b]): IndicatorValue => {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return { type: "range", min, max };
  });

/**
 * 生成时间序列型 IndicatorValue
 */
export const arbTimeSeriesValue = fc
  .record({
    years: fc.integer({ min: 1, max: 10 }),
    threshold: fc.option(fc.double({ min: -1000, max: 10000, noNaN: true })),
  })
  .map((config): IndicatorValue => ({
    type: "timeSeries",
    years: config.years,
    threshold: config.threshold ?? undefined,
  }));

/**
 * 检查 IndicatorField 和 IndicatorValue 类型是否匹配
 */
function isValueTypeCompatible(
  field: IndicatorField,
  value: IndicatorValue
): boolean {
  const metadata = INDICATOR_FIELD_METADATA[field];

  if (metadata.valueType === IndicatorValueType.NUMERIC) {
    return (
      value.type === "numeric" ||
      value.type === "range" ||
      value.type === "timeSeries"
    );
  }

  if (metadata.valueType === IndicatorValueType.TEXT) {
    return value.type === "text" || value.type === "list";
  }

  return false;
}

/**
 * 检查 ComparisonOperator 和 IndicatorValue 类型是否兼容
 */
function isOperatorCompatible(
  operator: ComparisonOperator,
  value: IndicatorValue
): boolean {
  switch (operator) {
    case ComparisonOperator.GREATER_THAN:
    case ComparisonOperator.LESS_THAN:
      return value.type === "numeric";

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
 * 生成有效的 FilterCondition（类型匹配且运算符兼容）
 */
export const arbValidFilterCondition = fc
  .tuple(
    arbIndicatorField,
    fc.constantFrom(...Object.values(ComparisonOperator)),
    fc.oneof(
      arbNumericValue,
      arbTextValue,
      arbListValue,
      arbRangeValue,
      arbTimeSeriesValue
    )
  )
  .filter(([field, operator, value]) => {
    return (
      isValueTypeCompatible(field, value) &&
      isOperatorCompatible(operator, value)
    );
  })
  .map(([field, operator, value]) =>
    FilterCondition.create(field, operator, value)
  );

/**
 * 生成 FilterGroup（递归结构，最大深度3）
 */
export const arbFilterGroup = (maxDepth = 3): fc.Arbitrary<FilterGroup> => {
  const arbLeafGroup = fc
    .record({
      operator: fc.constantFrom(LogicalOperator.AND, LogicalOperator.OR),
      conditions: fc.array(arbValidFilterCondition, { minLength: 1, maxLength: 3 }),
    })
    .map(({ operator, conditions }) =>
      FilterGroup.create(operator, conditions, [])
    );

  if (maxDepth <= 1) {
    return arbLeafGroup;
  }

  const arbRecursiveGroup = fc
    .record({
      operator: fc.constantFrom(LogicalOperator.AND, LogicalOperator.OR),
      conditions: fc.array(arbValidFilterCondition, { maxLength: 2 }),
      subGroups: fc.array(arbFilterGroup(maxDepth - 1), {
        minLength: 1,
        maxLength: 2,
      }),
    })
    .map(({ operator, conditions, subGroups }) =>
      FilterGroup.create(operator, conditions, subGroups)
    );

  // NOT 组特殊处理：只能有一个子元素
  const arbNotGroup = fc
    .oneof(
      arbValidFilterCondition.map((condition) =>
        FilterGroup.create(LogicalOperator.NOT, [condition], [])
      ),
      arbFilterGroup(maxDepth - 1).map((subGroup) =>
        FilterGroup.create(LogicalOperator.NOT, [], [subGroup])
      )
    );

  return fc.oneof(arbLeafGroup, arbRecursiveGroup, arbNotGroup);
};

/**
 * 生成有效的 ScoringConfig（权重之和为 1.0）
 */
export const arbScoringConfig = fc
  .array(
    fc.tuple(
      arbNumericIndicatorField,
      fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true })
    ),
    { minLength: 1, maxLength: 5 }
  )
  .chain((pairs) => {
    // 去重：确保每个指标只出现一次
    const uniquePairs = Array.from(
      new Map(pairs.map(([field, weight]) => [field, weight])).entries()
    );

    if (uniquePairs.length === 0) {
      // 如果去重后为空，返回一个默认配置
      return fc.constant(
        ScoringConfig.create(
          new Map([[IndicatorField.ROE, 1.0]]),
          NormalizationMethod.MIN_MAX
        )
      );
    }

    // 归一化权重使其和为 1.0
    const totalWeight = uniquePairs.reduce((sum, [, weight]) => sum + weight, 0);
    const normalizedWeights = new Map(
      uniquePairs.map(([field, weight]) => [field, weight / totalWeight])
    );

    return fc.constant(
      ScoringConfig.create(normalizedWeights, NormalizationMethod.MIN_MAX)
    );
  });

/**
 * 生成策略名称（非空且不仅包含空白字符）
 */
export const arbStrategyName = fc.string({ minLength: 1, maxLength: 50 }).filter(name => name.trim().length > 0);

/**
 * 生成用户ID
 */
export const arbUserId = fc.uuid();

/**
 * 生成 Stock 实体
 */
export const arbStock = fc.record({
  code: arbStockCode,
  name: fc.string({ minLength: 2, maxLength: 10 }),
  industry: fc.constantFrom("白酒", "医药", "银行", "科技", "制造"),
  sector: fc.constantFrom("主板", "创业板", "科创板"),
  roe: fc.option(fc.double({ min: -0.5, max: 1.0, noNaN: true })),
  pe: fc.option(fc.double({ min: 0, max: 200, noNaN: true })),
  pb: fc.option(fc.double({ min: 0, max: 50, noNaN: true })),
  eps: fc.option(fc.double({ min: -10, max: 100, noNaN: true })),
  revenue: fc.option(fc.double({ min: 0, max: 10000, noNaN: true })),
  netProfit: fc.option(fc.double({ min: -1000, max: 5000, noNaN: true })),
  debtRatio: fc.option(fc.double({ min: 0, max: 1.0, noNaN: true })),
  marketCap: fc.option(fc.double({ min: 10, max: 100000, noNaN: true })),
  floatMarketCap: fc.option(fc.double({ min: 10, max: 100000, noNaN: true })),
}).map((props) => {
  return new Stock({
    code: StockCode.create(props.code),
    name: props.name,
    industry: props.industry,
    sector: props.sector,
    roe: props.roe ?? null,
    pe: props.pe ?? null,
    pb: props.pb ?? null,
    eps: props.eps ?? null,
    revenue: props.revenue ?? null,
    netProfit: props.netProfit ?? null,
    debtRatio: props.debtRatio ?? null,
    marketCap: props.marketCap ?? null,
    floatMarketCap: props.floatMarketCap ?? null,
  });
});

/**
 * 生成 ScreeningStrategy 聚合根
 */
export const arbScreeningStrategy = fc
  .record({
    name: arbStrategyName,
    description: fc.option(fc.string({ maxLength: 200 })),
    filters: arbFilterGroup(),
    scoringConfig: arbScoringConfig,
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    isTemplate: fc.boolean(),
    userId: arbUserId,
  })
  .map((props) => {
    // 动态导入以避免循环依赖
    const { ScreeningStrategy } = require("../aggregates/screening-strategy.js");
    return ScreeningStrategy.create({
      name: props.name,
      description: props.description ?? undefined,
      filters: props.filters,
      scoringConfig: props.scoringConfig,
      tags: props.tags,
      isTemplate: props.isTemplate,
      userId: props.userId,
    });
  });

/**
 * 生成 WatchList 聚合根
 */
export const arbWatchList = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 50 }).filter(name => name.trim().length > 0),
    description: fc.option(fc.string({ maxLength: 200 })),
    userId: arbUserId,
    stocks: fc.array(
      fc.record({
        code: arbStockCode,
        name: fc.string({ minLength: 2, maxLength: 10 }),
        note: fc.option(fc.string({ maxLength: 100 })),
        tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
      }),
      { maxLength: 20 }
    ),
  })
  .map((props) => {
    // 动态导入以避免循环依赖
    const { WatchList } = require("../aggregates/watch-list.js");
    
    const watchList = WatchList.create({
      name: props.name,
      description: props.description ?? undefined,
      userId: props.userId,
    });

    // 添加股票（去重以避免 DuplicateStockError）
    const uniqueStocks = new Map(
      props.stocks.map(stock => [stock.code, stock])
    );

    for (const stock of uniqueStocks.values()) {
      watchList.addStock(
        StockCode.create(stock.code),
        stock.name,
        stock.note ?? undefined,
        stock.tags
      );
    }

    return watchList;
  });
