/**
 * 领域层异常类
 * 
 * 定义 Stock Screening Context 中的所有领域异常
 */

/**
 * 策略不变量验证失败异常
 * 
 * 触发场景：
 * - 策略名称为空
 * - 筛选条件组不包含任何有效条件
 * - 评分配置权重之和不等于 1.0
 * 
 * Requirements: 1.5, 1.6
 */
export class InvalidStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStrategyError";
    Object.setPrototypeOf(this, InvalidStrategyError.prototype);
  }
}

/**
 * 向自选股列表添加重复股票异常
 * 
 * 触发场景：
 * - 向 WatchList 添加已存在的股票代码
 * 
 * Requirements: 5.3
 */
export class DuplicateStockError extends Error {
  constructor(stockCode: string) {
    super(`股票 ${stockCode} 已存在于自选股列表中`);
    this.name = "DuplicateStockError";
    Object.setPrototypeOf(this, DuplicateStockError.prototype);
  }
}

/**
 * 股票未找到异常
 * 
 * 触发场景：
 * - 从 WatchList 移除不存在的股票
 * - 查询不存在的股票代码
 * 
 * Requirements: 5.3
 */
export class StockNotFoundError extends Error {
  constructor(stockCode: string) {
    super(`股票 ${stockCode} 未找到`);
    this.name = "StockNotFoundError";
    Object.setPrototypeOf(this, StockNotFoundError.prototype);
  }
}

/**
 * 筛选条件无效异常
 * 
 * 触发场景：
 * - IndicatorField 与 IndicatorValue 类型不匹配
 * - ComparisonOperator 与 IndicatorValue 类型不兼容
 * - FilterCondition 构造验证失败
 * 
 * Requirements: 1.5
 */
export class InvalidFilterConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFilterConditionError";
    Object.setPrototypeOf(this, InvalidFilterConditionError.prototype);
  }
}

/**
 * 评分计算失败异常
 * 
 * 触发场景：
 * - 所有股票的某个评分指标均为 null
 * - 归一化计算失败（如 min === max）
 * - 评分配置无效
 * 
 * Requirements: 6.5
 */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
    Object.setPrototypeOf(this, ScoringError.prototype);
  }
}

/**
 * 指标计算失败异常
 * 
 * 触发场景：
 * - 除零错误
 * - 必需数据缺失
 * - 派生指标计算公式错误
 * - 历史数据不足
 * 
 * Requirements: 6.5
 */
export class IndicatorCalculationError extends Error {
  constructor(indicator: string, reason: string) {
    super(`指标 ${indicator} 计算失败: ${reason}`);
    this.name = "IndicatorCalculationError";
    Object.setPrototypeOf(this, IndicatorCalculationError.prototype);
  }
}

/**
 * 数据不可用异常
 * 
 * 触发场景：
 * - Python 数据服务返回错误
 * - Python 数据服务超时
 * - 外部数据源不可用
 * - 网络连接失败
 * 
 * Requirements: 6.5
 */
export class DataNotAvailableError extends Error {
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message);
    this.name = "DataNotAvailableError";
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, DataNotAvailableError.prototype);
  }
}
