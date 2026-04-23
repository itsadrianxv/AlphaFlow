/**
 * FilterCondition 值对象
 *
 * 代表单个筛选条件（如 ROE > 15%）。
 * 负责验证指标字段、比较运算符和指标值之间的类型兼容性，
 * 并提供条件评估和序列化功能。
 *
 * 设计原则：
 * - 不可变性：所有属性为只读
 * - 构造时验证：确保类型匹配和运算符兼容性
 * - 值对象语义：基于内容相等性
 *
 * Requirements: 2.2, 2.3, 2.6, 3.3
 *
 * @example
 * // 创建数值比较条件
 * const condition = FilterCondition.create(
 *   IndicatorField.ROE,
 *   ComparisonOperator.GREATER_THAN,
 *   { type: "numeric", value: 0.15 }
 * );
 *
 * // 评估股票是否匹配条件
 * const matches = condition.evaluate(stock, calcService);
 *
 * // 序列化
 * const dict = condition.toDict();
 * const restored = FilterCondition.fromDict(dict);
 */

import type { Stock } from "../entities/stock";
import { ComparisonOperator } from "../enums/comparison-operator";
import {
  getIndicatorLookbackYears,
  getIndicatorValueType,
  type IndicatorField,
  IndicatorValueType,
  isTimeSeriesIndicator,
} from "../enums/indicator-field";
import { InvalidFilterConditionError } from "../errors";
import {
  type IndicatorValue,
  indicatorValueEquals,
  indicatorValueFromDict,
  indicatorValueToDict,
  isListValue,
  isNumericValue,
  isRangeValue,
  isTextValue,
  isTimeSeriesValue,
} from "./indicator-value";

/**
 * 指标计算服务接口（前向声明）
 * 用于计算 TIME_SERIES 和 DERIVED 类别的指标
 */
export interface IIndicatorCalculationService {
  calculateIndicator(
    indicator: IndicatorField,
    stock: Stock,
  ): number | string | null | Promise<number | string | null>;
}

/**
 * FilterCondition 值对象
 */
export class FilterCondition {
  readonly field: IndicatorField;
  readonly operator: ComparisonOperator;
  readonly value: IndicatorValue;

  /**
   * 私有构造函数，使用静态工厂方法 create 创建实例
   */
  private constructor(
    field: IndicatorField,
    operator: ComparisonOperator,
    value: IndicatorValue,
  ) {
    this.field = field;
    this.operator = operator;
    this.value = value;
  }

  /**
   * 创建 FilterCondition 实例
   *
   * 执行以下验证：
   * 1. IndicatorField.valueType 与 IndicatorValue.type 匹配
   * 2. ComparisonOperator 与 IndicatorValue.type 兼容
   *
   * @param field 指标字段
   * @param operator 比较运算符
   * @param value 指标值
   * @returns FilterCondition 实例
   * @throws InvalidFilterConditionError 如果验证失败
   *
   * Requirements: 2.2, 2.3
   */
  static create(
    field: IndicatorField,
    operator: ComparisonOperator,
    value: IndicatorValue,
  ): FilterCondition {
    // 验证类型匹配
    FilterCondition.validateTypeMatch(field, value);

    // 验证运算符兼容性
    FilterCondition.validateOperatorCompatibility(field, operator, value);

    return new FilterCondition(field, operator, value);
  }

  /**
   * 验证 IndicatorField.valueType 与 IndicatorValue.type 匹配
   *
   * 规则：
   * - NUMERIC 指标 → numeric / range / timeSeries
   * - TEXT 指标 → text / list
   *
   * Requirements: 2.2
   */
  private static validateTypeMatch(
    field: IndicatorField,
    value: IndicatorValue,
  ): void {
    const fieldValueType = getIndicatorValueType(field);

    if (fieldValueType === IndicatorValueType.NUMERIC) {
      // 数值型指标支持 numeric、range、timeSeries
      if (
        !isNumericValue(value) &&
        !isRangeValue(value) &&
        value.type !== "timeSeries"
      ) {
        throw new InvalidFilterConditionError(
          `指标 ${field} 为数值类型，但提供的值类型为 ${value.type}`,
        );
      }

      if (isTimeSeriesValue(value) && !isTimeSeriesIndicator(field)) {
        throw new InvalidFilterConditionError(
          `指标 ${field} 不是时间序列指标，不能使用 timeSeries 值`,
        );
      }
    } else if (fieldValueType === IndicatorValueType.TEXT) {
      // 文本型指标支持 text、list
      if (!isTextValue(value) && !isListValue(value)) {
        throw new InvalidFilterConditionError(
          `指标 ${field} 为文本类型，但提供的值类型为 ${value.type}`,
        );
      }
    }
  }

  /**
   * 验证 ComparisonOperator 与 IndicatorValue.type 兼容
   *
   * 规则：
   * - GREATER_THAN, LESS_THAN → numeric 或 timeSeries（时间序列最终计算为数值）
   * - EQUAL, NOT_EQUAL → numeric 或 text
   * - IN, NOT_IN → 仅 list
   * - BETWEEN → 仅 range
   * - CONTAINS → 仅 text
   *
   * Requirements: 2.3
   */
  private static validateOperatorCompatibility(
    field: IndicatorField,
    operator: ComparisonOperator,
    value: IndicatorValue,
  ): void {
    switch (operator) {
      case ComparisonOperator.GREATER_THAN:
      case ComparisonOperator.LESS_THAN:
        // timeSeries 最终计算为数值，所以也支持数值比较运算符
        if (!isNumericValue(value) && value.type !== "timeSeries") {
          throw new InvalidFilterConditionError(
            `运算符 ${operator} 仅适用于 numeric 或 timeSeries 类型，但提供的值类型为 ${value.type}`,
          );
        }
        if (isTimeSeriesValue(value) && value.threshold === undefined) {
          throw new InvalidFilterConditionError(
            `时间序列条件 ${field} 必须提供 threshold`,
          );
        }
        if (isTimeSeriesValue(value)) {
          const lookbackYears = getIndicatorLookbackYears(field);
          if (lookbackYears !== undefined && value.years !== lookbackYears) {
            throw new InvalidFilterConditionError(
              `指标 ${field} 固定使用 ${lookbackYears} 年窗口，当前提供 ${value.years} 年`,
            );
          }
        }
        break;

      case ComparisonOperator.EQUAL:
      case ComparisonOperator.NOT_EQUAL:
        if (!isNumericValue(value) && !isTextValue(value)) {
          throw new InvalidFilterConditionError(
            `运算符 ${operator} 仅适用于 numeric 或 text 类型，但提供的值类型为 ${value.type}`,
          );
        }
        break;

      case ComparisonOperator.IN:
      case ComparisonOperator.NOT_IN:
        if (!isListValue(value)) {
          throw new InvalidFilterConditionError(
            `运算符 ${operator} 仅适用于 list 类型，但提供的值类型为 ${value.type}`,
          );
        }
        break;

      case ComparisonOperator.BETWEEN:
        if (!isRangeValue(value)) {
          throw new InvalidFilterConditionError(
            `运算符 ${operator} 仅适用于 range 类型，但提供的值类型为 ${value.type}`,
          );
        }
        break;

      case ComparisonOperator.CONTAINS:
        if (!isTextValue(value)) {
          throw new InvalidFilterConditionError(
            `运算符 ${operator} 仅适用于 text 类型，但提供的值类型为 ${value.type}`,
          );
        }
        break;

      default:
        throw new InvalidFilterConditionError(`未知的比较运算符: ${operator}`);
    }
  }

  /**
   * 评估股票是否匹配此筛选条件
   *
   * 规则：
   * - 如果指标值为 null，返回 false（Requirements: 3.3）
   * - 根据运算符执行相应的比较逻辑
   *
   * @param stock 股票实体
   * @param calcService 指标计算服务（用于 TIME_SERIES 和 DERIVED 指标）
   * @returns 是否匹配
   *
   * Requirements: 3.3
   */
  evaluate(stock: Stock, calcService: IIndicatorCalculationService): boolean {
    // 获取股票的指标值
    const stockValue = calcService.calculateIndicator(this.field, stock);

    // 同步路径不处理 Promise（异步路径请使用 evaluateAsync）
    if (stockValue instanceof Promise) {
      return false;
    }

    // null 值返回 false (Requirements: 3.3)
    if (stockValue === null) {
      return false;
    }

    // 根据运算符执行比较
    return this.compareValues(stockValue, this.operator, this.value);
  }

  /**
   * 异步评估股票是否匹配此筛选条件
   *
   * 用于支持异步指标计算（如历史数据指标）。
   */
  async evaluateAsync(
    stock: Stock,
    calcService: IIndicatorCalculationService,
  ): Promise<boolean> {
    const stockValue = await calcService.calculateIndicator(this.field, stock);

    if (stockValue === null) {
      return false;
    }

    return this.compareValues(stockValue, this.operator, this.value);
  }

  /**
   * 执行值比较
   */
  private compareValues(
    stockValue: number | string,
    operator: ComparisonOperator,
    conditionValue: IndicatorValue,
  ): boolean {
    switch (operator) {
      case ComparisonOperator.GREATER_THAN:
        if (typeof stockValue === "number" && isNumericValue(conditionValue)) {
          return stockValue > conditionValue.value;
        }
        if (
          typeof stockValue === "number" &&
          isTimeSeriesValue(conditionValue) &&
          typeof conditionValue.threshold === "number"
        ) {
          return stockValue > conditionValue.threshold;
        }
        return false;

      case ComparisonOperator.LESS_THAN:
        if (typeof stockValue === "number" && isNumericValue(conditionValue)) {
          return stockValue < conditionValue.value;
        }
        if (
          typeof stockValue === "number" &&
          isTimeSeriesValue(conditionValue) &&
          typeof conditionValue.threshold === "number"
        ) {
          return stockValue < conditionValue.threshold;
        }
        return false;

      case ComparisonOperator.EQUAL:
        if (typeof stockValue === "number" && isNumericValue(conditionValue)) {
          return stockValue === conditionValue.value;
        }
        if (typeof stockValue === "string" && isTextValue(conditionValue)) {
          return stockValue === conditionValue.value;
        }
        return false;

      case ComparisonOperator.NOT_EQUAL:
        if (typeof stockValue === "number" && isNumericValue(conditionValue)) {
          return stockValue !== conditionValue.value;
        }
        if (typeof stockValue === "string" && isTextValue(conditionValue)) {
          return stockValue !== conditionValue.value;
        }
        return false;

      case ComparisonOperator.IN:
        if (typeof stockValue === "string" && isListValue(conditionValue)) {
          return conditionValue.values.includes(stockValue);
        }
        return false;

      case ComparisonOperator.NOT_IN:
        if (typeof stockValue === "string" && isListValue(conditionValue)) {
          return !conditionValue.values.includes(stockValue);
        }
        return false;

      case ComparisonOperator.BETWEEN:
        if (typeof stockValue === "number" && isRangeValue(conditionValue)) {
          return (
            stockValue >= conditionValue.min && stockValue <= conditionValue.max
          );
        }
        return false;

      case ComparisonOperator.CONTAINS:
        if (typeof stockValue === "string" && isTextValue(conditionValue)) {
          return stockValue.includes(conditionValue.value);
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * 判断两个 FilterCondition 是否相等
   */
  equals(other: FilterCondition | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return (
      this.field === other.field &&
      this.operator === other.operator &&
      indicatorValueEquals(this.value, other.value)
    );
  }

  /**
   * 序列化为普通对象
   *
   * Requirements: 2.6
   */
  toDict(): Record<string, unknown> {
    return {
      field: this.field,
      operator: this.operator,
      value: indicatorValueToDict(this.value),
    };
  }

  /**
   * 从普通对象反序列化
   *
   * Requirements: 2.6
   */
  static fromDict(data: Record<string, unknown>): FilterCondition {
    const field = data.field as IndicatorField;
    const operator = data.operator as ComparisonOperator;
    const value = indicatorValueFromDict(data.value as Record<string, unknown>);

    return FilterCondition.create(field, operator, value);
  }

  /**
   * 转换为字符串表示
   */
  toString(): string {
    let valueStr = "";
    if (isNumericValue(this.value)) {
      valueStr = `${this.value.value}${this.value.unit ?? ""}`;
    } else if (isTextValue(this.value)) {
      valueStr = `"${this.value.value}"`;
    } else if (isListValue(this.value)) {
      valueStr = `[${this.value.values.join(", ")}]`;
    } else if (isRangeValue(this.value)) {
      valueStr = `[${this.value.min}, ${this.value.max}]`;
    } else {
      valueStr = `timeSeries(${this.value.years}年)`;
    }

    return `${this.field} ${this.operator} ${valueStr}`;
  }
}
