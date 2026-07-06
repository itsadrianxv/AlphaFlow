/**
 * 比较运算符枚举
 * 定义筛选条件中可用的比较操作
 */
export enum ComparisonOperator {
  /** 大于：仅适用于 NumericValue */
  GREATER_THAN = "GREATER_THAN",
  /** 小于：仅适用于 NumericValue */
  LESS_THAN = "LESS_THAN",
  /** 等于：适用于 NumericValue 和 TextValue */
  EQUAL = "EQUAL",
  /** 不等于：适用于 NumericValue 和 TextValue */
  NOT_EQUAL = "NOT_EQUAL",
  /** 包含于：仅适用于 ListValue */
  IN = "IN",
  /** 不包含于：仅适用于 ListValue */
  NOT_IN = "NOT_IN",
  /** 区间：仅适用于 RangeValue */
  BETWEEN = "BETWEEN",
  /** 包含：仅适用于 TextValue */
  CONTAINS = "CONTAINS",
}
