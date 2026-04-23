/**
 * ScoredStock 值对象
 *
 * 表示经过筛选和评分后的股票，包含评分详情和匹配的筛选条件。
 */

import type { IndicatorField } from "../enums/indicator-field";
import { StockCode } from "./stock-code";

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
  private readonly _scoreContributions: ReadonlyMap<IndicatorField, number>;
  private readonly _indicatorValues: ReadonlyMap<IndicatorField, unknown>;
  private readonly _matchedConditions: readonly MatchedCondition[];
  private readonly _scoreExplanations: readonly string[];

  private constructor(
    stockCode: StockCode,
    stockName: string,
    score: number,
    scoreBreakdown: Map<IndicatorField, number>,
    indicatorValues: Map<IndicatorField, unknown>,
    matchedConditions: MatchedCondition[],
    scoreContributions?: Map<IndicatorField, number>,
    scoreExplanations?: string[],
  ) {
    this._stockCode = stockCode;
    this._stockName = stockName;
    this._score = score;
    this._scoreBreakdown = new Map(scoreBreakdown);
    this._scoreContributions = new Map(scoreContributions ?? []);
    this._indicatorValues = new Map(indicatorValues);
    this._matchedConditions = [...matchedConditions];
    this._scoreExplanations = [...(scoreExplanations ?? [])];
  }

  get stockCode(): StockCode {
    return this._stockCode;
  }

  get stockName(): string {
    return this._stockName;
  }

  get score(): number {
    return this._score;
  }

  get scoreBreakdown(): ReadonlyMap<IndicatorField, number> {
    return this._scoreBreakdown;
  }

  get scoreContributions(): ReadonlyMap<IndicatorField, number> {
    return this._scoreContributions;
  }

  get indicatorValues(): ReadonlyMap<IndicatorField, unknown> {
    return this._indicatorValues;
  }

  get matchedConditions(): readonly MatchedCondition[] {
    return this._matchedConditions;
  }

  get scoreExplanations(): readonly string[] {
    return this._scoreExplanations;
  }

  static create(
    stockCode: StockCode,
    stockName: string,
    score: number,
    scoreBreakdown: Map<IndicatorField, number>,
    indicatorValues: Map<IndicatorField, unknown>,
    matchedConditions: MatchedCondition[],
    scoreContributions?: Map<IndicatorField, number>,
    scoreExplanations?: string[],
  ): ScoredStock {
    if (score < 0 || score > 1) {
      throw new Error(`评分必须在 [0, 1] 区间内，当前值为 ${score}`);
    }

    for (const [field, breakdownScore] of scoreBreakdown.entries()) {
      if (breakdownScore < 0 || breakdownScore > 1) {
        throw new Error(
          `指标 ${field} 的归一化得分必须在 [0, 1] 区间内，当前值为 ${breakdownScore}`,
        );
      }
    }

    if (scoreContributions) {
      for (const [field, contribution] of scoreContributions.entries()) {
        if (contribution < 0 || contribution > 1) {
          throw new Error(
            `指标 ${field} 的贡献值必须在 [0, 1] 区间内，当前值为 ${contribution}`,
          );
        }
      }
    }

    return new ScoredStock(
      stockCode,
      stockName,
      score,
      scoreBreakdown,
      indicatorValues,
      matchedConditions,
      scoreContributions,
      scoreExplanations,
    );
  }

  getBreakdownScore(field: IndicatorField): number | undefined {
    return this._scoreBreakdown.get(field);
  }

  getContribution(field: IndicatorField): number | undefined {
    return this._scoreContributions.get(field);
  }

  getIndicatorValue(field: IndicatorField): unknown {
    return this._indicatorValues.get(field);
  }

  toDict(): Record<string, unknown> {
    const scoreBreakdownObj: Record<string, number> = {};
    for (const [field, score] of this._scoreBreakdown.entries()) {
      scoreBreakdownObj[field] = score;
    }

    const scoreContributionsObj: Record<string, number> = {};
    for (const [field, contribution] of this._scoreContributions.entries()) {
      scoreContributionsObj[field] = contribution;
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
      scoreContributions: scoreContributionsObj,
      scoreExplanations: [...this._scoreExplanations],
      indicatorValues: indicatorValuesObj,
      matchedConditions: this._matchedConditions.map((c) => ({ ...c })),
    };
  }

  static fromDict(data: Record<string, unknown>): ScoredStock {
    const stockCode = data.stockCode as string;
    const stockName = data.stockName as string;
    const score = data.score as number;
    const scoreBreakdownObj = data.scoreBreakdown as Record<string, number>;
    const scoreContributionsObj =
      (data.scoreContributions as Record<string, number> | undefined) ?? {};
    const scoreExplanations =
      (data.scoreExplanations as string[] | undefined) ?? [];
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
    if (
      typeof scoreContributionsObj !== "object" ||
      scoreContributionsObj === null
    ) {
      throw new Error("scoreContributions 必须为对象");
    }
    if (!Array.isArray(scoreExplanations)) {
      throw new Error("scoreExplanations 必须为数组");
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

    const scoreContributions = new Map<IndicatorField, number>();
    for (const [field, contribution] of Object.entries(scoreContributionsObj)) {
      scoreContributions.set(field as IndicatorField, contribution);
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
      matchedConditionsData,
      scoreContributions,
      scoreExplanations,
    );
  }
}
