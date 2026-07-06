/**
 * IMarketDataRepository 接口
 *
 * 定义市场数据查询接口（共享内核）。
 * 提供全市场股票数据的访问能力，由基础设施层实现（通过 Python 数据服务）。
 *
 * Requirements: 6.1, 6.2, 6.4
 */

import type { Stock } from "../entities/stock";
import type { StockCode } from "../value-objects/stock-code";

/**
 * 市场数据仓储接口
 */
export interface IMarketDataRepository {
  /**
   * 获取全市场 A 股股票代码列表
   * @returns 股票代码列表
   */
  getAllStockCodes(): Promise<StockCode[]>;

  /**
   * 根据股票代码获取股票信息
   * @param code 股票代码
   * @returns 股票实例或 null（如果不存在）
   */
  getStock(code: StockCode): Promise<Stock | null>;

  /**
   * 批量获取股票信息
   * @param codes 股票代码列表
   * @returns 股票实例列表
   */
  getStocksByCodes(codes: StockCode[]): Promise<Stock[]>;

  /**
   * 获取可用的行业列表
   * @returns 行业名称列表
   */
  getAvailableIndustries(): Promise<string[]>;
}
