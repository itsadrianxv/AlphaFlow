/**
 * IHistoricalDataProvider 接口
 *
 * 定义历史数据提供者接口，用于获取股票的历史财务指标数据。
 * 主要用于 TIME_SERIES 类别指标的计算（如 CAGR、增长率等）。
 *
 * Requirements: 3.2, 6.3
 */

import type { StockCode } from "../value-objects/stock-code";
import type { IndicatorField } from "../enums/indicator-field";

/**
 * 指标数据点
 * 表示某个时间点的指标值
 */
export interface IndicatorDataPoint {
  /** 数据日期 */
  date: Date;
  /** 指标值 */
  value: number;
  /** 是否为预估值 */
  isEstimated: boolean;
}

/**
 * 历史数据提供者接口
 */
export interface IHistoricalDataProvider {
  /**
   * 获取指定股票的历史指标数据
   *
   * @param stockCode 股票代码
   * @param indicator 指标字段
   * @param years 获取最近 N 年的数据
   * @returns 指标数据点列表（按时间升序排列）
   *
   * @example
   * // 获取贵州茅台最近 3 年的营收数据
   * const dataPoints = await provider.getIndicatorHistory(
   *   StockCode.create("600519"),
   *   IndicatorField.REVENUE,
   *   3
   * );
   * // 返回: [
   * //   { date: 2021-12-31, value: 1094.2, isEstimated: false },
   * //   { date: 2022-12-31, value: 1212.6, isEstimated: false },
   * //   { date: 2023-12-31, value: 1275.5, isEstimated: false }
   * // ]
   */
  getIndicatorHistory(
    stockCode: StockCode,
    indicator: IndicatorField,
    years: number
  ): Promise<IndicatorDataPoint[]>;
}
