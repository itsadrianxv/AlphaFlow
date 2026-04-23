/**
 * WatchedStock 值对象
 *
 * 表示自选股列表中的一只股票，包含股票基本信息、添加时间、备注和标签。
 *
 * 包含字段：
 * - stockCode: 股票代码
 * - stockName: 股票名称
 * - addedAt: 添加时间
 * - note: 备注（可选）
 * - tags: 标签列表
 *
 * @example
 * const watchedStock = WatchedStock.create(
 *   StockCode.create("600519"),
 *   "贵州茅台",
 *   new Date(),
 *   "长期看好",
 *   ["白酒", "高ROE"]
 * );
 */

import { StockCode } from "./stock-code";

/**
 * 标签规范化：去空白 + 小写 + 去重
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
}

/**
 * WatchedStock 值对象
 */
export class WatchedStock {
  private readonly _stockCode: StockCode;
  private readonly _stockName: string;
  private readonly _addedAt: Date;
  private readonly _note?: string;
  private readonly _tags: readonly string[];

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   */
  private constructor(
    stockCode: StockCode,
    stockName: string,
    addedAt: Date,
    note?: string,
    tags: string[] = [],
  ) {
    this._stockCode = stockCode;
    this._stockName = stockName;
    this._addedAt = addedAt;
    this._note = note;
    this._tags = normalizeTags(tags);
  }

  /**
   * 获取股票代码
   */
  get stockCode(): StockCode {
    return this._stockCode;
  }

  /**
   * 获取股票名称
   */
  get stockName(): string {
    return this._stockName;
  }

  /**
   * 获取添加时间
   */
  get addedAt(): Date {
    return this._addedAt;
  }

  /**
   * 获取备注
   */
  get note(): string | undefined {
    return this._note;
  }

  /**
   * 获取标签列表
   */
  get tags(): readonly string[] {
    return this._tags;
  }

  /**
   * 创建 WatchedStock 实例
   * @param stockCode 股票代码
   * @param stockName 股票名称
   * @param addedAt 添加时间
   * @param note 备注（可选）
   * @param tags 标签列表（可选）
   * @returns WatchedStock 实例
   */
  static create(
    stockCode: StockCode,
    stockName: string,
    addedAt: Date,
    note?: string,
    tags: string[] = [],
  ): WatchedStock {
    return new WatchedStock(stockCode, stockName, addedAt, note, tags);
  }

  /**
   * 判断是否包含指定标签
   * @param tag 标签
   * @returns 是否包含
   */
  hasTag(tag: string): boolean {
    return this._tags.includes(tag.trim().toLowerCase());
  }

  /**
   * 创建带有新备注的副本
   * @param note 新备注
   * @returns 新的 WatchedStock 实例
   */
  withNote(note: string): WatchedStock {
    return new WatchedStock(
      this._stockCode,
      this._stockName,
      this._addedAt,
      note,
      [...this._tags],
    );
  }

  /**
   * 创建带有新标签的副本
   * @param tags 新标签列表
   * @returns 新的 WatchedStock 实例
   */
  withTags(tags: string[]): WatchedStock {
    return new WatchedStock(
      this._stockCode,
      this._stockName,
      this._addedAt,
      this._note,
      normalizeTags(tags),
    );
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    return {
      stockCode: this._stockCode.value,
      stockName: this._stockName,
      addedAt: this._addedAt.toISOString(),
      ...(this._note !== undefined && { note: this._note }),
      tags: [...this._tags],
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns WatchedStock 实例
   * @throws Error 如果数据格式无效
   */
  static fromDict(data: Record<string, unknown>): WatchedStock {
    const stockCode = data.stockCode as string;
    const stockName = data.stockName as string;
    const addedAt = data.addedAt as string;
    const note = data.note as string | undefined;
    const tags = data.tags as string[];

    if (typeof stockCode !== "string") {
      throw new Error("stockCode 必须为字符串");
    }
    if (typeof stockName !== "string") {
      throw new Error("stockName 必须为字符串");
    }
    if (typeof addedAt !== "string") {
      throw new Error("addedAt 必须为字符串");
    }
    if (tags !== undefined && !Array.isArray(tags)) {
      throw new Error("tags 必须为数组");
    }

    return WatchedStock.create(
      StockCode.create(stockCode),
      stockName,
      new Date(addedAt),
      note,
      tags ?? [],
    );
  }

  /**
   * 判断两个 WatchedStock 是否相等（基于股票代码）
   * @param other 另一个 WatchedStock
   * @returns 是否相等
   */
  equals(other: WatchedStock | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._stockCode.equals(other._stockCode);
  }
}
