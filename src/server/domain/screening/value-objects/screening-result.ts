/**
 * ScreeningResult 值对象
 *
 * 表示筛选执行的结果，包含匹配的股票列表、扫描总数和执行时间。
 *
 * 包含字段：
 * - matchedStocks: 匹配的股票列表（按评分降序排列）
 * - totalScanned: 扫描的股票总数
 * - executionTime: 执行时间（毫秒）
 *
 * @example
 * const result = ScreeningResult.create(
 *   [scoredStock1, scoredStock2],
 *   5000,
 *   1250.5
 * );
 */

import type { ScoredStock } from "./scored-stock";

/**
 * ScreeningResult 值对象
 */
export class ScreeningResult {
  private readonly _matchedStocks: readonly ScoredStock[];
  private readonly _totalScanned: number;
  private readonly _executionTime: number;

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   */
  private constructor(
    matchedStocks: ScoredStock[],
    totalScanned: number,
    executionTime: number
  ) {
    this._matchedStocks = [...matchedStocks];
    this._totalScanned = totalScanned;
    this._executionTime = executionTime;
  }

  /**
   * 获取匹配的股票列表
   */
  get matchedStocks(): readonly ScoredStock[] {
    return this._matchedStocks;
  }

  /**
   * 获取扫描的股票总数
   */
  get totalScanned(): number {
    return this._totalScanned;
  }

  /**
   * 获取执行时间（毫秒）
   */
  get executionTime(): number {
    return this._executionTime;
  }

  /**
   * 创建 ScreeningResult 实例
   * @param matchedStocks 匹配的股票列表
   * @param totalScanned 扫描的股票总数
   * @param executionTime 执行时间（毫秒）
   * @returns ScreeningResult 实例
   * @throws Error 如果参数无效
   */
  static create(
    matchedStocks: ScoredStock[],
    totalScanned: number,
    executionTime: number
  ): ScreeningResult {
    // 验证 totalScanned 为非负整数
    if (totalScanned < 0 || !Number.isInteger(totalScanned)) {
      throw new Error(`totalScanned 必须为非负整数，当前值为 ${totalScanned}`);
    }

    // 验证 executionTime 为非负数
    if (executionTime < 0) {
      throw new Error(`executionTime 必须为非负数，当前值为 ${executionTime}`);
    }

    // 验证 matchedStocks 数量不超过 totalScanned
    if (matchedStocks.length > totalScanned) {
      throw new Error(
        `匹配股票数量 (${matchedStocks.length}) 不能超过扫描总数 (${totalScanned})`
      );
    }

    // 验证 matchedStocks 按评分降序排列
    for (let i = 0; i < matchedStocks.length - 1; i++) {
      if (matchedStocks[i]!.score < matchedStocks[i + 1]!.score) {
        throw new Error(
          `匹配股票列表必须按评分降序排列，但在索引 ${i} 处发现逆序：` +
            `${matchedStocks[i]!.score} < ${matchedStocks[i + 1]!.score}`
        );
      }
    }

    return new ScreeningResult(matchedStocks, totalScanned, executionTime);
  }

  /**
   * 获取匹配股票数量
   * @returns 匹配股票数量
   */
  getMatchedCount(): number {
    return this._matchedStocks.length;
  }

  /**
   * 获取前 N 只股票
   * @param n 数量
   * @returns 前 N 只股票
   */
  getTopN(n: number): ScoredStock[] {
    return this._matchedStocks.slice(0, n);
  }

  /**
   * 判断是否有匹配结果
   * @returns 是否有匹配结果
   */
  hasMatches(): boolean {
    return this._matchedStocks.length > 0;
  }

  /**
   * 获取匹配率
   * @returns 匹配率（0-1 之间）
   */
  getMatchRate(): number {
    if (this._totalScanned === 0) {
      return 0;
    }
    return this._matchedStocks.length / this._totalScanned;
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    return {
      matchedStocks: this._matchedStocks.map((stock) => stock.toDict()),
      totalScanned: this._totalScanned,
      executionTime: this._executionTime,
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns ScreeningResult 实例
   * @throws Error 如果数据格式无效
   */
  static fromDict(data: Record<string, unknown>): ScreeningResult {
    const matchedStocksData = data.matchedStocks as Record<string, unknown>[];
    const totalScanned = data.totalScanned as number;
    const executionTime = data.executionTime as number;

    if (!Array.isArray(matchedStocksData)) {
      throw new Error("matchedStocks 必须为数组");
    }
    if (typeof totalScanned !== "number") {
      throw new Error("totalScanned 必须为数字");
    }
    if (typeof executionTime !== "number") {
      throw new Error("executionTime 必须为数字");
    }

    // Lazy import to avoid circular dependency
    const { ScoredStock: ScoredStockClass } = require("./scored-stock") as typeof import("./scored-stock");

    const matchedStocks = matchedStocksData.map((stockData) =>
      ScoredStockClass.fromDict(stockData)
    );

    return ScreeningResult.create(matchedStocks, totalScanned, executionTime);
  }
}
