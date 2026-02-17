/**
 * ScoredStock 值对象
 *
 * 表示经过筛选和评分后的股票，包含评分详情和匹配的筛选条件。
 *
 * 包含字段：
 * - stockCode: 股票代码
 * - stockName: 股票名称
 * - score: 总评分（0-1 区间）
 * - scoreBreakdown: 各指标的归一化得分
 * - indicatorValues: 各指标的原始值
 * - matchedConditions: 匹配的筛选条件
 *
 * @example
 * const scoredStock = ScoredStock.create(
 *   StockCode.create("600519"),
 *   "贵州茅台",
 *   0.85,
 *   new Map([[IndicatorField.ROE, 0.9], [IndicatorField.PE, 0.7]]),
 *   new Map([[IndicatorField.ROE, 0.28], [IndicatorField.PE, 35.5]]),
 *   []
 * );
 */

import { StockCode } from "./stock-code.js";
import type { IndicatorField } from "../enums/indicator-field";

/**
 * 筛选条件简化表示（用于 matchedConditions）
 */
export interface MatchedCondition {
  readonly field: IndicatorField;
  readonly operator: string;
  readonly value: Record<string, unknown>;
}

/**
 * ScoredStock 值对象
 */
export class ScoredStock {
  private readonly _stockCode: StockCode;
  private readonly _stockName: string;
  private readonly _score: number;
  private readonly _scoreBreakdown: ReadonlyMap<IndicatorField, number>;
  private readonly _indicatorValues: ReadonlyMap<IndicatorField, unknown>;
  private readonly _matchedConditions: readonly MatchedCondition[];

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   */
  private constructor(
    stockCode: StockCode,
    stockName: string,
    score: number,
    scoreBreakdown: Map<IndicatorField, number>,
    indicatorValues: Map<IndicatorField, unknown>,
    matchedConditions: MatchedCondition[]
  ) {
    this._stockCode = stockCode;
    this._stockName = stockName;
    this._score = score;
    this._scoreBreakdown = new Map(scoreBreakdown);
    this._indicatorValues = new Map(indicatorValues);
    this._matchedConditions = [...matchedConditions];
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
   * 获取总评分
   */
  get score(): number {
    return this._score;
  }

  /**
   * 获取评分明细
   */
  get scoreBreakdown(): ReadonlyMap<IndicatorField, number> {
    return this._scoreBreakdown;
  }

  /**
   * 获取指标原始值
   */
  get indicatorValues(): ReadonlyMap<IndicatorField, unknown> {
    return this._indicatorValues;
  }

  /**
   * 获取匹配的筛选条件
   */
  get matchedConditions(): readonly MatchedCondition[] {
    return this._matchedConditions;
  }

  /**
   * 创建 ScoredStock 实例
   * @param stockCode 股票代码
   * @param stockName 股票名称
   * @param score 总评分
   * @param scoreBreakdown 评分明细
   * @param indicatorValues 指标原始值
   * @param matchedConditions 匹配的筛选条件
   * @returns ScoredStock 实例
   * @throws Error 如果评分不在 [0, 1] 区间
   */
  static create(
    stockCode: StockCode,
    stockName: string,
    score: number,
    scoreBreakdown: Map<IndicatorField, number>,
    indicatorValues: Map<IndicatorField, unknown>,
    matchedConditions: MatchedCondition[]
  ): ScoredStock {
    // 验证评分在 [0, 1] 区间
    if (score < 0 || score > 1) {
      throw new Error(`评分必须在 [0, 1] 区间内，当前值为 ${score}`);
    }

    // 验证 scoreBreakdown 中的所有值都在 [0, 1] 区间
    for (const [field, breakdownScore] of scoreBreakdown.entries()) {
      if (breakdownScore < 0 || breakdownScore > 1) {
        throw new Error(
          `指标 ${field} 的归一化得分必须在 [0, 1] 区间内，当前值为 ${breakdownScore}`
        );
      }
    }

    return new ScoredStock(
      stockCode,
      stockName,
      score,
      scoreBreakdown,
      indicatorValues,
      matchedConditions
    );
  }

  /**
   * 获取指定指标的归一化得分
   * @param field 指标字段
   * @returns 归一化得分，如果不存在则返回 undefined
   */
  getBreakdownScore(field: IndicatorField): number | undefined {
    return this._scoreBreakdown.get(field);
  }

  /**
   * 获取指定指标的原始值
   * @param field 指标字段
   * @returns 原始值，如果不存在则返回 undefined
   */
  getIndicatorValue(field: IndicatorField): unknown {
    return this._indicatorValues.get(field);
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    const scoreBreakdownObj: Record<string, number> = {};
    for (const [field, score] of this._scoreBreakdown.entries()) {
      scoreBreakdownObj[field] = score;
    }

    const indicatorValuesObj: Record<string, unknown> = {};
    for (const [field, value] of this._indicatorValues.entries()) {
      indicatorValuesObj[field] = value;
    }

    return {
      stockCode: this._stockCode.value,
      stockName: this._stockName,
      score: this._score,
      scoreBreakdown: scoreBreakdownObj,
      indicatorValues: indicatorValuesObj,
      matchedConditions: this._matchedConditions.map((c) => ({ ...c })),
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns ScoredStock 实例
   * @throws Error 如果数据格式无效
   */
  static fromDict(data: Record<string, unknown>): ScoredStock {
    const stockCode = data.stockCode as string;
    const stockName = data.stockName as string;
    const score = data.score as number;
    const scoreBreakdownObj = data.scoreBreakdown as Record<string, number>;
    const indicatorValuesObj = data.indicatorValues as Record<string, unknown>;
    const matchedConditionsData = data.matchedConditions as MatchedCondition[];

    if (typeof stockCode !== "string") {
      throw new Error("stockCode 必须为字符串");
    }
    if (typeof stockName !== "string") {
      throw new Error("stockName 必须为字符串");
    }
    if (typeof score !== "number") {
      throw new Error("score 必须为数字");
    }
    if (typeof scoreBreakdownObj !== "object" || scoreBreakdownObj === null) {
      throw new Error("scoreBreakdown 必须为对象");
    }
    if (typeof indicatorValuesObj !== "object" || indicatorValuesObj === null) {
      throw new Error("indicatorValues 必须为对象");
    }
    if (!Array.isArray(matchedConditionsData)) {
      throw new Error("matchedConditions 必须为数组");
    }

    const scoreBreakdown = new Map<IndicatorField, number>();
    for (const [field, breakdownScore] of Object.entries(scoreBreakdownObj)) {
      scoreBreakdown.set(field as IndicatorField, breakdownScore);
    }

    const indicatorValues = new Map<IndicatorField, unknown>();
    for (const [field, value] of Object.entries(indicatorValuesObj)) {
      indicatorValues.set(field as IndicatorField, value);
    }

    return ScoredStock.create(
      StockCode.create(stockCode),
      stockName,
      score,
      scoreBreakdown,
      indicatorValues,
      matchedConditionsData
    );
  }
}
