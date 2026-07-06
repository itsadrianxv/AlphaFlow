/**
 * WatchList 聚合根
 *
 * 用户管理关注股票的列表，支持添加、移除、更新备注和标签等操作。
 * 作为聚合根，WatchList 负责维护自选股列表的一致性和业务规则。
 *
 * 业务规则：
 * - 不允许添加重复的股票（基于 StockCode）
 * - 移除不存在的股票时抛出异常
 *
 * 核心行为：
 * - addStock: 添加股票到列表（重复检查）
 * - removeStock: 从列表移除股票
 * - updateStockNote: 更新股票备注
 * - updateStockTags: 更新股票标签
 * - contains: 检查是否包含指定股票
 * - getStocksByTag: 按标签过滤股票
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { v4 as uuidv4 } from "uuid";
import { DuplicateStockError, StockNotFoundError } from "../errors";
import type { StockCode } from "../value-objects/stock-code";
import { WatchedStock } from "../value-objects/watched-stock";

/**
 * WatchList 创建参数
 */
export interface CreateWatchListParams {
  name: string;
  description?: string;
  userId: string;
  id?: string;
  stocks?: WatchedStock[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * WatchList 聚合根
 */
export class WatchList {
  private readonly _id: string;
  private _name: string;
  private _description: string;
  private readonly _stocks: Map<string, WatchedStock>;
  private readonly _userId: string;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(params: CreateWatchListParams) {
    this._id = params.id ?? uuidv4();
    this._name = WatchList.normalizeName(params.name);
    this._description = WatchList.normalizeDescription(params.description);
    this._stocks = new Map();
    this._userId = params.userId;
    this._createdAt = params.createdAt ?? new Date();
    this._updatedAt = params.updatedAt ?? new Date();

    // 初始化股票列表
    if (params.stocks) {
      for (const stock of params.stocks) {
        this._stocks.set(stock.stockCode.value, stock);
      }
    }
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get stocks(): readonly WatchedStock[] {
    return Array.from(this._stocks.values());
  }

  get userId(): string {
    return this._userId;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * 创建 WatchList 实例
   * @param params 创建参数
   * @returns WatchList 实例
   */
  static create(params: CreateWatchListParams): WatchList {
    return new WatchList(params);
  }

  /**
   * 重命名列表
   * @param name 新名称
   */
  rename(name: string): void {
    const normalizedName = WatchList.normalizeName(name);
    if (normalizedName === this._name) {
      return;
    }
    this._name = normalizedName;
    this._updatedAt = new Date();
  }

  /**
   * 更新列表描述
   * @param description 新描述
   */
  updateDescription(description?: string): void {
    const normalizedDescription = WatchList.normalizeDescription(description);
    if (normalizedDescription === this._description) {
      return;
    }
    this._description = normalizedDescription;
    this._updatedAt = new Date();
  }

  /**
   * 添加股票到自选股列表
   * @param code 股票代码
   * @param name 股票名称
   * @param note 备注（可选）
   * @param tags 标签列表（可选）
   * @throws DuplicateStockError 如果股票已存在
   *
   * Requirements: 5.2, 5.3
   */
  addStock(
    code: StockCode,
    name: string,
    note?: string,
    tags: string[] = [],
  ): void {
    if (this._stocks.has(code.value)) {
      throw new DuplicateStockError(code.value);
    }

    const watchedStock = WatchedStock.create(
      code,
      name,
      new Date(),
      note,
      tags,
    );

    this._stocks.set(code.value, watchedStock);
    this._updatedAt = new Date();
  }

  /**
   * 从自选股列表移除股票
   * @param code 股票代码
   * @throws StockNotFoundError 如果股票不存在
   *
   * Requirements: 5.4
   */
  removeStock(code: StockCode): void {
    if (!this._stocks.has(code.value)) {
      throw new StockNotFoundError(code.value);
    }

    this._stocks.delete(code.value);
    this._updatedAt = new Date();
  }

  /**
   * 更新股票备注
   * @param code 股票代码
   * @param note 新备注
   * @throws StockNotFoundError 如果股票不存在
   *
   * Requirements: 5.2
   */
  updateStockNote(code: StockCode, note: string): void {
    const stock = this._stocks.get(code.value);
    if (!stock) {
      throw new StockNotFoundError(code.value);
    }

    const updatedStock = stock.withNote(note);
    this._stocks.set(code.value, updatedStock);
    this._updatedAt = new Date();
  }

  /**
   * 更新股票标签
   * @param code 股票代码
   * @param tags 新标签列表
   * @throws StockNotFoundError 如果股票不存在
   *
   * Requirements: 5.2
   */
  updateStockTags(code: StockCode, tags: string[]): void {
    const stock = this._stocks.get(code.value);
    if (!stock) {
      throw new StockNotFoundError(code.value);
    }

    const updatedStock = stock.withTags(tags);
    this._stocks.set(code.value, updatedStock);
    this._updatedAt = new Date();
  }

  /**
   * 检查是否包含指定股票
   * @param code 股票代码
   * @returns 是否包含
   *
   * Requirements: 5.2
   */
  contains(code: StockCode): boolean {
    return this._stocks.has(code.value);
  }

  /**
   * 按标签过滤股票
   * @param tag 标签
   * @returns 包含该标签的所有股票
   *
   * Requirements: 5.5
   */
  getStocksByTag(tag: string): WatchedStock[] {
    return Array.from(this._stocks.values()).filter((stock) =>
      stock.hasTag(tag),
    );
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      name: this._name,
      description: this._description,
      stocks: Array.from(this._stocks.values()).map((stock) => stock.toDict()),
      userId: this._userId,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns WatchList 实例
   */
  static fromDict(data: Record<string, unknown>): WatchList {
    const stocks = (data.stocks as Array<Record<string, unknown>>).map(
      (stockData) => WatchedStock.fromDict(stockData),
    );

    return WatchList.create({
      id: data.id as string,
      name: data.name as string,
      description: data.description as string,
      stocks,
      userId: data.userId as string,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
    });
  }

  /**
   * 判断两个 WatchList 是否相等（基于 ID）
   * @param other 另一个 WatchList
   * @returns 是否相等
   */
  equals(other: WatchList | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }

  /**
   * 转换为字符串
   * @returns 字符串表示
   */
  toString(): string {
    return `WatchList(${this._id}, ${this._name}, ${this._stocks.size} stocks)`;
  }

  private static normalizeName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new Error("自选股列表名称不能为空");
    }
    return normalized;
  }

  private static normalizeDescription(description?: string): string {
    return description?.trim() ?? "";
  }
}
