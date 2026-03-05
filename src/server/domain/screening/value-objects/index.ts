/**
 * Value Objects 统一导出
 *
 * 本模块导出 Stock Screening Context 中的所有值对象。
 */

// 股票代码
export { StockCode, StockMarket, InvalidStockCodeError } from "./stock-code";
export type { StockCodeValidationResult } from "./stock-code";

// 指标值
export {
  isNumericValue,
  isTextValue,
  isListValue,
  isRangeValue,
  isTimeSeriesValue,
  createNumericValue,
  createTextValue,
  createListValue,
  createRangeValue,
  createTimeSeriesValue,
  indicatorValueToDict,
  indicatorValueFromDict,
  indicatorValueEquals,
} from "./indicator-value";
export type {
  IndicatorValue,
  NumericValue,
  TextValue,
  ListValue,
  RangeValue,
  TimeSeriesValue,
  IndicatorValueTypeTag,
} from "./indicator-value";

// 评分配置
export {
  ScoringConfig,
  NormalizationMethod,
  InvalidScoringConfigError,
} from "./scoring-config";
export type { ScoringConfigValidationResult } from "./scoring-config";

// 带评分股票
export { ScoredStock } from "./scored-stock";
export type { MatchedCondition } from "./scored-stock";

// 自选股
export { WatchedStock } from "./watched-stock";

// 筛选结果
export { ScreeningResult } from "./screening-result";
