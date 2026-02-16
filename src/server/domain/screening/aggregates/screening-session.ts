/**
 * ScreeningSession 聚合根
 *
 * 记录某次筛选执行的结果快照，包含筛选策略信息、执行时间和匹配结果。
 * 为了优化存储，前 50 只股票保存完整的 ScoredStock 信息，其余仅保存 StockCode。
 *
 * 核心特性：
 * - 分层存储：前 50 只完整信息，其余仅代码
 * - 快照保存：保存执行时的 FilterGroup 和 ScoringConfig，确保可复现
 * - 不可变性：创建后不可修改（只读聚合根）
 *
 * Requirements: 3.6, 3.7, 4.3
 */

import { v4 as uuidv4 } from "uuid";
import { ScoredStock } from "../value-objects/scored-stock.js";
import { StockCode } from "../value-objects/stock-code.js";
import { FilterGroup } from "../entities/filter-group.js";
import { ScoringConfig } from "../value-objects/scoring-config.js";
import type { ScreeningResult } from "../value-objects/screening-result.js";

/**
 * ScreeningSession 创建参数
 */
export interface CreateScreeningSessionParams {
  strategyId: string | null;
  strategyName: string;
  result: ScreeningResult;
  filtersSnapshot: FilterGroup;
  scoringConfigSnapshot: ScoringConfig;
  id?: string;
  executedAt?: Date;
}

/**
 * ScreeningSession 聚合根
 */
export class ScreeningSession {
  private readonly _id: string;
  private readonly _strategyId: string | null;
  private readonly _strategyName: string;
  private readonly _executedAt: Date;
  private readonly _totalScanned: number;
  private readonly _executionTime: number;
  private readonly _topStocks: readonly ScoredStock[];
  private readonly _otherStockCodes: readonly StockCode[];
  private readonly _filtersSnapshot: FilterGroup;
  private readonly _scoringConfigSnapshot: ScoringConfig;

  /**
   * 前 N 只股票保存完整信息的阈值
   */
  private static readonly TOP_STOCKS_THRESHOLD = 50;

  private constructor(
    id: string,
    strategyId: string | null,
    strategyName: string,
    executedAt: Date,
    totalScanned: number,
    executionTime: number,
    topStocks: ScoredStock[],
    otherStockCodes: StockCode[],
    filtersSnapshot: FilterGroup,
    scoringConfigSnapshot: ScoringConfig
  ) {
    this._id = id;
    this._strategyId = strategyId;
    this._strategyName = strategyName;
    this._executedAt = executedAt;
    this._totalScanned = totalScanned;
    this._executionTime = executionTime;
    this._topStocks = [...topStocks];
    this._otherStockCodes = [...otherStockCodes];
    this._filtersSnapshot = filtersSnapshot;
    this._scoringConfigSnapshot = scoringConfigSnapshot;
  }

  get id(): string {
    return this._id;
  }

  get strategyId(): string | null {
    return this._strategyId;
  }

  get strategyName(): string {
    return this._strategyName;
  }

  get executedAt(): Date {
    return this._executedAt;
  }

  get totalScanned(): number {
    return this._totalScanned;
  }

  get executionTime(): number {
    return this._executionTime;
  }

  get topStocks(): readonly ScoredStock[] {
    return this._topStocks;
  }

  get otherStockCodes(): readonly StockCode[] {
    return this._otherStockCodes;
  }

  get filtersSnapshot(): FilterGroup {
    return this._filtersSnapshot;
  }

  get scoringConfigSnapshot(): ScoringConfig {
    return this._scoringConfigSnapshot;
  }

  /**
   * 创建 ScreeningSession 实例
   *
   * 实现分层存储策略：
   * - 前 50 只股票保存完整 ScoredStock 信息
   * - 其余股票仅保存 StockCode
   *
   * @param params 创建参数
   * @returns ScreeningSession 实例
   *
   * Requirements: 3.6
   */
  static create(params: CreateScreeningSessionParams): ScreeningSession {
    const id = params.id ?? uuidv4();
    const executedAt = params.executedAt ?? new Date();

    const matchedStocks = params.result.matchedStocks;

    // 分层存储：前 50 只完整信息，其余仅代码
    const topStocks = matchedStocks.slice(
      0,
      ScreeningSession.TOP_STOCKS_THRESHOLD
    );
    const otherStocks = matchedStocks.slice(
      ScreeningSession.TOP_STOCKS_THRESHOLD
    );
    const otherStockCodes = otherStocks.map((stock) => stock.stockCode);

    return new ScreeningSession(
      id,
      params.strategyId,
      params.strategyName,
      executedAt,
      params.result.totalScanned,
      params.result.executionTime,
      topStocks,
      otherStockCodes,
      params.filtersSnapshot,
      params.scoringConfigSnapshot
    );
  }

  /**
   * 获取所有匹配股票的代码列表
   *
   * @returns 所有匹配股票的代码
   */
  getAllMatchedCodes(): StockCode[] {
    const topCodes = this._topStocks.map((stock) => stock.stockCode);
    return [...topCodes, ...this._otherStockCodes];
  }

  /**
   * 获取指定股票的详细信息
   *
   * 只有前 50 只股票有完整信息，其余返回 null
   *
   * @param code 股票代码
   * @returns ScoredStock 或 null
   */
  getStockDetail(code: StockCode): ScoredStock | null {
    return (
      this._topStocks.find((stock) => stock.stockCode.equals(code)) ?? null
    );
  }

  /**
   * 获取前 N 只股票
   *
   * @param n 数量
   * @returns 前 N 只股票（最多返回 topStocks 的长度）
   */
  getTopN(n: number): ScoredStock[] {
    return this._topStocks.slice(0, n);
  }

  /**
   * 获取匹配股票总数
   *
   * @returns 匹配股票总数
   */
  countMatched(): number {
    return this._topStocks.length + this._otherStockCodes.length;
  }

  /**
   * 序列化为普通对象
   *
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      strategyId: this._strategyId,
      strategyName: this._strategyName,
      executedAt: this._executedAt.toISOString(),
      totalScanned: this._totalScanned,
      executionTime: this._executionTime,
      topStocks: this._topStocks.map((stock) => stock.toDict()),
      otherStockCodes: this._otherStockCodes.map((code) => code.value),
      filtersSnapshot: this._filtersSnapshot.toDict(),
      scoringConfigSnapshot: this._scoringConfigSnapshot.toDict(),
    };
  }

  /**
   * 从普通对象反序列化
   *
   * @param data 序列化的对象
   * @returns ScreeningSession 实例
   * @throws Error 如果数据格式无效
   */
  static fromDict(data: Record<string, unknown>): ScreeningSession {
    const id = data.id as string;
    const strategyId = data.strategyId as string | null;
    const strategyName = data.strategyName as string;
    const executedAt = new Date(data.executedAt as string);
    const totalScanned = data.totalScanned as number;
    const executionTime = data.executionTime as number;
    const topStocksData = data.topStocks as Record<string, unknown>[];
    const otherStockCodesData = data.otherStockCodes as string[];
    const filtersSnapshotData = data.filtersSnapshot as Record<string, unknown>;
    const scoringConfigSnapshotData = data.scoringConfigSnapshot as Record<
      string,
      unknown
    >;

    // 验证必需字段
    if (typeof id !== "string") {
      throw new Error("id 必须为字符串");
    }
    if (typeof strategyName !== "string") {
      throw new Error("strategyName 必须为字符串");
    }
    if (typeof totalScanned !== "number") {
      throw new Error("totalScanned 必须为数字");
    }
    if (typeof executionTime !== "number") {
      throw new Error("executionTime 必须为数字");
    }
    if (!Array.isArray(topStocksData)) {
      throw new Error("topStocks 必须为数组");
    }
    if (!Array.isArray(otherStockCodesData)) {
      throw new Error("otherStockCodes 必须为数组");
    }

    // 导入依赖类型 - 直接使用顶部导入的类
    // 反序列化
    const topStocks = topStocksData.map((stockData) =>
      ScoredStock.fromDict(stockData)
    );
    const otherStockCodes = otherStockCodesData.map((code) =>
      StockCode.create(code)
    );
    const filtersSnapshot = FilterGroup.fromDict(filtersSnapshotData);
    const scoringConfigSnapshot = ScoringConfig.fromDict(
      scoringConfigSnapshotData
    );

    return new ScreeningSession(
      id,
      strategyId,
      strategyName,
      executedAt,
      totalScanned,
      executionTime,
      topStocks,
      otherStockCodes,
      filtersSnapshot,
      scoringConfigSnapshot
    );
  }

  /**
   * 判断两个 ScreeningSession 是否相等（基于 id）
   */
  equals(other: ScreeningSession | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }

  /**
   * 转换为字符串表示
   */
  toString(): string {
    return `ScreeningSession(${this._id}, ${this._strategyName}, ${this.countMatched()} matched)`;
  }
}
