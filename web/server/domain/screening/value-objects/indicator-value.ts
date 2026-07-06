/**
 * IndicatorValue Tagged Union 值对象
 *
 * 定义筛选条件中使用的各种指标值类型，采用 Tagged Union 模式实现类型安全的多态值。
 *
 * 支持的值类型：
 * - NumericValue: 数值类型，用于 ROE、PE、PB 等数值指标
 * - TextValue: 文本类型，用于行业、板块等文本指标
 * - ListValue: 列表类型，用于 IN/NOT_IN 运算符
 * - RangeValue: 范围类型，用于 BETWEEN 运算符
 * - TimeSeriesValue: 时间序列类型，用于历史数据计算
 *
 * @example
 * const numericValue: IndicatorValue = { type: "numeric", value: 0.15, unit: "%" };
 * const textValue: IndicatorValue = { type: "text", value: "白酒" };
 * const listValue: IndicatorValue = { type: "list", values: ["白酒", "医药"] };
 * const rangeValue: IndicatorValue = { type: "range", min: 10, max: 30 };
 * const timeSeriesValue: IndicatorValue = { type: "timeSeries", years: 3, threshold: 0.1 };
 */

/**
 * 数值类型指标值
 * 用于数值型指标的比较（如 ROE > 15%）
 */
export interface NumericValue {
  readonly type: "numeric";
  /** 数值 */
  readonly value: number;
  /** 单位（可选，如 "%"、"亿元"） */
  readonly unit?: string;
}

/**
 * 文本类型指标值
 * 用于文本型指标的比较（如 行业 = "白酒"）
 */
export interface TextValue {
  readonly type: "text";
  /** 文本值 */
  readonly value: string;
}

/**
 * 列表类型指标值
 * 用于 IN/NOT_IN 运算符（如 行业 IN ["白酒", "医药"]）
 */
export interface ListValue {
  readonly type: "list";
  /** 值列表 */
  readonly values: string[];
}

/**
 * 范围类型指标值
 * 用于 BETWEEN 运算符（如 PE BETWEEN 10 AND 30）
 */
export interface RangeValue {
  readonly type: "range";
  /** 最小值（包含） */
  readonly min: number;
  /** 最大值（包含） */
  readonly max: number;
}

/**
 * 时间序列类型指标值
 * 用于历史数据计算（如 3年ROE平均值 > 15%）
 */
export interface TimeSeriesValue {
  readonly type: "timeSeries";
  /** 年数 */
  readonly years: number;
  /** 阈值（可选，用于某些计算场景） */
  readonly threshold?: number;
}

/**
 * 指标值 Tagged Union 类型
 * 所有指标值类型的联合类型
 */
export type IndicatorValue =
  | NumericValue
  | TextValue
  | ListValue
  | RangeValue
  | TimeSeriesValue;

/**
 * 指标值类型字面量
 */
export type IndicatorValueTypeTag =
  | "numeric"
  | "text"
  | "list"
  | "range"
  | "timeSeries";

// ========== 类型守卫函数 ==========

/**
 * 判断是否为数值类型指标值
 * @param value 指标值
 * @returns 是否为 NumericValue
 */
export function isNumericValue(value: IndicatorValue): value is NumericValue {
  return value.type === "numeric";
}

/**
 * 判断是否为文本类型指标值
 * @param value 指标值
 * @returns 是否为 TextValue
 */
export function isTextValue(value: IndicatorValue): value is TextValue {
  return value.type === "text";
}

/**
 * 判断是否为列表类型指标值
 * @param value 指标值
 * @returns 是否为 ListValue
 */
export function isListValue(value: IndicatorValue): value is ListValue {
  return value.type === "list";
}

/**
 * 判断是否为范围类型指标值
 * @param value 指标值
 * @returns 是否为 RangeValue
 */
export function isRangeValue(value: IndicatorValue): value is RangeValue {
  return value.type === "range";
}

/**
 * 判断是否为时间序列类型指标值
 * @param value 指标值
 * @returns 是否为 TimeSeriesValue
 */
export function isTimeSeriesValue(
  value: IndicatorValue,
): value is TimeSeriesValue {
  return value.type === "timeSeries";
}

// ========== 工厂函数 ==========

/**
 * 创建数值类型指标值
 * @param value 数值
 * @param unit 单位（可选）
 * @returns NumericValue
 */
export function createNumericValue(value: number, unit?: string): NumericValue {
  return { type: "numeric", value, unit };
}

/**
 * 创建文本类型指标值
 * @param value 文本值
 * @returns TextValue
 */
export function createTextValue(value: string): TextValue {
  return { type: "text", value };
}

/**
 * 创建列表类型指标值
 * @param values 值列表
 * @returns ListValue
 */
export function createListValue(values: string[]): ListValue {
  return { type: "list", values: [...values] };
}

/**
 * 创建范围类型指标值
 * @param min 最小值
 * @param max 最大值
 * @returns RangeValue
 * @throws Error 如果 min > max
 */
export function createRangeValue(min: number, max: number): RangeValue {
  if (min > max) {
    throw new Error(`范围值无效：min (${min}) 不能大于 max (${max})`);
  }
  return { type: "range", min, max };
}

/**
 * 创建时间序列类型指标值
 * @param years 年数
 * @param threshold 阈值（可选）
 * @returns TimeSeriesValue
 * @throws Error 如果 years <= 0
 */
export function createTimeSeriesValue(
  years: number,
  threshold?: number,
): TimeSeriesValue {
  if (years <= 0) {
    throw new Error(`时间序列年数必须大于 0，当前值为 ${years}`);
  }
  return { type: "timeSeries", years, threshold };
}

// ========== 序列化/反序列化 ==========

/**
 * 将 IndicatorValue 序列化为普通对象
 * @param value 指标值
 * @returns 序列化后的对象
 */
export function indicatorValueToDict(
  value: IndicatorValue,
): Record<string, unknown> {
  switch (value.type) {
    case "numeric":
      return {
        type: value.type,
        value: value.value,
        ...(value.unit !== undefined && { unit: value.unit }),
      };
    case "text":
      return {
        type: value.type,
        value: value.value,
      };
    case "list":
      return {
        type: value.type,
        values: [...value.values],
      };
    case "range":
      return {
        type: value.type,
        min: value.min,
        max: value.max,
      };
    case "timeSeries":
      return {
        type: value.type,
        years: value.years,
        ...(value.threshold !== undefined && { threshold: value.threshold }),
      };
  }
}

/**
 * 从普通对象反序列化为 IndicatorValue
 * @param data 序列化的对象
 * @returns IndicatorValue
 * @throws Error 如果数据格式无效
 */
export function indicatorValueFromDict(
  data: Record<string, unknown>,
): IndicatorValue {
  const type = data.type as string;

  switch (type) {
    case "numeric": {
      const value = data.value as number;
      const unit = data.unit as string | undefined;
      if (typeof value !== "number") {
        throw new Error("NumericValue 的 value 必须为数字");
      }
      return createNumericValue(value, unit);
    }
    case "text": {
      const value = data.value as string;
      if (typeof value !== "string") {
        throw new Error("TextValue 的 value 必须为字符串");
      }
      return createTextValue(value);
    }
    case "list": {
      const values = data.values as string[];
      if (!Array.isArray(values)) {
        throw new Error("ListValue 的 values 必须为数组");
      }
      return createListValue(values);
    }
    case "range": {
      const min = data.min as number;
      const max = data.max as number;
      if (typeof min !== "number" || typeof max !== "number") {
        throw new Error("RangeValue 的 min 和 max 必须为数字");
      }
      return createRangeValue(min, max);
    }
    case "timeSeries": {
      const years = data.years as number;
      const threshold = data.threshold as number | undefined;
      if (typeof years !== "number") {
        throw new Error("TimeSeriesValue 的 years 必须为数字");
      }
      return createTimeSeriesValue(years, threshold);
    }
    default:
      throw new Error(`未知的 IndicatorValue 类型: ${type}`);
  }
}

/**
 * 判断两个 IndicatorValue 是否相等
 * @param a 第一个指标值
 * @param b 第二个指标值
 * @returns 是否相等
 */
export function indicatorValueEquals(
  a: IndicatorValue,
  b: IndicatorValue,
): boolean {
  if (a.type !== b.type) {
    return false;
  }

  switch (a.type) {
    case "numeric": {
      const bNumeric = b as NumericValue;
      return a.value === bNumeric.value && a.unit === bNumeric.unit;
    }
    case "text": {
      const bText = b as TextValue;
      return a.value === bText.value;
    }
    case "list": {
      const bList = b as ListValue;
      if (a.values.length !== bList.values.length) {
        return false;
      }
      return a.values.every((v, i) => v === bList.values[i]);
    }
    case "range": {
      const bRange = b as RangeValue;
      return a.min === bRange.min && a.max === bRange.max;
    }
    case "timeSeries": {
      const bTimeSeries = b as TimeSeriesValue;
      return (
        a.years === bTimeSeries.years && a.threshold === bTimeSeries.threshold
      );
    }
  }
}
