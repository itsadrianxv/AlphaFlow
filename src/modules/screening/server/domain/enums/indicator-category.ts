/**
 * 指标类别枚举
 * 定义指标的计算来源类型
 */
export enum IndicatorCategory {
  /** 基础指标：直接从 Stock 实体获取 */
  BASIC = "BASIC",
  /** 时间序列指标：需要从历史数据计算 */
  TIME_SERIES = "TIME_SERIES",
  /** 衍生指标：由基础指标通过公式计算得出 */
  DERIVED = "DERIVED",
}
