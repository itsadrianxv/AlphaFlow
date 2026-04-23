import { IndicatorCategory } from "./indicator-category";

/**
 * 指标值类型
 */
export enum IndicatorValueType {
  /** 数值类型 */
  NUMERIC = "NUMERIC",
  /** 文本类型 */
  TEXT = "TEXT",
}

/**
 * 指标字段元数据
 */
export interface IndicatorFieldMetadata {
  /** 指标类别：决定计算来源 */
  category: IndicatorCategory;
  /** 值类型：决定可用的比较运算符 */
  valueType: IndicatorValueType;
  /** 指标描述 */
  description: string;
  /** 单位（可选） */
  unit?: string;
  /** 时间序列指标对应的回溯年数 */
  lookbackYears?: number;
}

/**
 * 指标字段枚举
 * 定义所有可用的筛选和评分指标
 */
export enum IndicatorField {
  // ========== 基础指标 (BASIC) ==========
  /** 净资产收益率 */
  ROE = "ROE",
  /** 市盈率 */
  PE = "PE",
  /** 市净率 */
  PB = "PB",
  /** 每股收益 */
  EPS = "EPS",
  /** 营业收入 */
  REVENUE = "REVENUE",
  /** 净利润 */
  NET_PROFIT = "NET_PROFIT",
  /** 资产负债率 */
  DEBT_RATIO = "DEBT_RATIO",
  /** 总市值 */
  MARKET_CAP = "MARKET_CAP",
  /** 流通市值 */
  FLOAT_MARKET_CAP = "FLOAT_MARKET_CAP",
  /** 行业 */
  INDUSTRY = "INDUSTRY",
  /** 板块 */
  SECTOR = "SECTOR",

  // ========== 时间序列指标 (TIME_SERIES) ==========
  /** 3年营收复合增长率 */
  REVENUE_CAGR_3Y = "REVENUE_CAGR_3Y",
  /** 3年净利润复合增长率 */
  NET_PROFIT_CAGR_3Y = "NET_PROFIT_CAGR_3Y",
  /** 3年ROE平均值 */
  ROE_AVG_3Y = "ROE_AVG_3Y",

  // ========== 衍生指标 (DERIVED) ==========
  /** PEG（市盈率相对盈利增长比率） */
  PEG = "PEG",
  /** ROE与负债率之差 */
  ROE_MINUS_DEBT = "ROE_MINUS_DEBT",
}

/**
 * 指标字段元数据映射表
 */
export const INDICATOR_FIELD_METADATA: Record<
  IndicatorField,
  IndicatorFieldMetadata
> = {
  // 基础指标
  [IndicatorField.ROE]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "净资产收益率",
    unit: "%",
  },
  [IndicatorField.PE]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "市盈率",
  },
  [IndicatorField.PB]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "市净率",
  },
  [IndicatorField.EPS]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "每股收益",
    unit: "元",
  },
  [IndicatorField.REVENUE]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "营业收入",
    unit: "亿元",
  },
  [IndicatorField.NET_PROFIT]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "净利润",
    unit: "亿元",
  },
  [IndicatorField.DEBT_RATIO]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "资产负债率",
    unit: "%",
  },
  [IndicatorField.MARKET_CAP]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "总市值",
    unit: "亿元",
  },
  [IndicatorField.FLOAT_MARKET_CAP]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.NUMERIC,
    description: "流通市值",
    unit: "亿元",
  },
  [IndicatorField.INDUSTRY]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.TEXT,
    description: "行业",
  },
  [IndicatorField.SECTOR]: {
    category: IndicatorCategory.BASIC,
    valueType: IndicatorValueType.TEXT,
    description: "板块",
  },

  // 时间序列指标
  [IndicatorField.REVENUE_CAGR_3Y]: {
    category: IndicatorCategory.TIME_SERIES,
    valueType: IndicatorValueType.NUMERIC,
    description: "3年营收复合增长率",
    unit: "%",
    lookbackYears: 3,
  },
  [IndicatorField.NET_PROFIT_CAGR_3Y]: {
    category: IndicatorCategory.TIME_SERIES,
    valueType: IndicatorValueType.NUMERIC,
    description: "3年净利润复合增长率",
    unit: "%",
    lookbackYears: 3,
  },
  [IndicatorField.ROE_AVG_3Y]: {
    category: IndicatorCategory.TIME_SERIES,
    valueType: IndicatorValueType.NUMERIC,
    description: "3年ROE平均值",
    unit: "%",
    lookbackYears: 3,
  },

  // 衍生指标
  [IndicatorField.PEG]: {
    category: IndicatorCategory.DERIVED,
    valueType: IndicatorValueType.NUMERIC,
    description: "市盈率相对盈利增长比率",
  },
  [IndicatorField.ROE_MINUS_DEBT]: {
    category: IndicatorCategory.DERIVED,
    valueType: IndicatorValueType.NUMERIC,
    description: "ROE与负债率之差",
    unit: "%",
  },
};

/**
 * 获取指标字段的元数据
 */
export function getIndicatorFieldMetadata(
  field: IndicatorField,
): IndicatorFieldMetadata {
  return INDICATOR_FIELD_METADATA[field];
}

/**
 * 获取指标字段的类别
 */
export function getIndicatorCategory(field: IndicatorField): IndicatorCategory {
  return INDICATOR_FIELD_METADATA[field].category;
}

/**
 * 获取时间序列指标预期的回溯年数
 */
export function getIndicatorLookbackYears(
  field: IndicatorField,
): number | undefined {
  return INDICATOR_FIELD_METADATA[field].lookbackYears;
}

/**
 * 获取指标字段的值类型
 */
export function getIndicatorValueType(
  field: IndicatorField,
): IndicatorValueType {
  return INDICATOR_FIELD_METADATA[field].valueType;
}

/**
 * 判断指标是否为数值类型
 */
export function isNumericIndicator(field: IndicatorField): boolean {
  return (
    INDICATOR_FIELD_METADATA[field].valueType === IndicatorValueType.NUMERIC
  );
}

/**
 * 判断指标是否为文本类型
 */
export function isTextIndicator(field: IndicatorField): boolean {
  return INDICATOR_FIELD_METADATA[field].valueType === IndicatorValueType.TEXT;
}

/**
 * 判断指标是否为时间序列指标
 */
export function isTimeSeriesIndicator(field: IndicatorField): boolean {
  return (
    INDICATOR_FIELD_METADATA[field].category === IndicatorCategory.TIME_SERIES
  );
}

/**
 * 按类别获取指标字段列表
 */
export function getIndicatorsByCategory(
  category: IndicatorCategory,
): IndicatorField[] {
  return Object.values(IndicatorField).filter(
    (field) => INDICATOR_FIELD_METADATA[field].category === category,
  );
}
