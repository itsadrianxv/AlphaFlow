/**
 * IScoringService 领域服务
 *
 * 负责股票评分计算，实现归一化和加权求和。
 *
 * 评分流程：
 * 1. 对每只股票计算 ScoringConfig 中指定的指标值
 * 2. 对每个指标在所有股票中做归一化（MIN_MAX / Z_SCORE）
 * 3. 缺失指标的归一化得分设为 0
 * 4. 加权求和：score = Σ(归一化值 × 权重)
 *
 * Requirements: 3.4, 3.5
 */

import type { Stock } from "../entities/stock";
import type { IndicatorField } from "../enums/indicator-field";
import { ScoredStock } from "../value-objects/scored-stock";
import {
  NormalizationMethod,
  type ScoringConfig,
  ScoringDirection,
} from "../value-objects/scoring-config";
import type { IIndicatorCalculationService } from "./indicator-calculation-service";

/**
 * 评分服务接口
 */
export interface IScoringService {
  /**
   * 对股票列表进行评分
   *
   * @param stocks 股票列表
   * @param config 评分配置
   * @param calcService 指标计算服务
   * @returns 带评分的股票列表（按评分降序排列）
   */
  scoreStocks(
    stocks: Stock[],
    config: ScoringConfig,
    calcService: IIndicatorCalculationService,
  ): Promise<ScoredStock[]>;
}

/**
 * 评分服务实现
 */
export class ScoringService implements IScoringService {
  /**
   * 对股票列表进行评分
   */
  async scoreStocks(
    stocks: Stock[],
    config: ScoringConfig,
    calcService: IIndicatorCalculationService,
  ): Promise<ScoredStock[]> {
    if (stocks.length === 0) {
      return [];
    }

    const fields = config.getFields();
    const stockIndicatorValues = await this.calculateAllIndicators(
      stocks,
      fields,
      calcService,
    );

    const normalizedValues = this.normalizeIndicators(
      stockIndicatorValues,
      fields,
      config,
    );

    const scoredStocks = this.calculateWeightedScores(
      stocks,
      normalizedValues,
      stockIndicatorValues,
      config,
    );

    scoredStocks.sort((a, b) => b.score - a.score);
    return scoredStocks;
  }

  /**
   * 计算所有股票的所有指标值
   */
  private async calculateAllIndicators(
    stocks: Stock[],
    fields: IndicatorField[],
    calcService: IIndicatorCalculationService,
  ): Promise<Map<number, Map<IndicatorField, number | string | null>>> {
    const result = new Map<
      number,
      Map<IndicatorField, number | string | null>
    >();

    const promises = stocks.map(async (stock, index) => {
      const values = await calcService.calculateBatch(fields, stock);
      return { index, values };
    });

    const results = await Promise.all(promises);
    for (const { index, values } of results) {
      result.set(index, values);
    }

    return result;
  }

  /**
   * 对每个指标做归一化
   */
  private normalizeIndicators(
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    fields: IndicatorField[],
    config: ScoringConfig,
  ): Map<number, Map<IndicatorField, number>> {
    const normalizedValues = new Map<number, Map<IndicatorField, number>>();

    for (const stockIndex of stockIndicatorValues.keys()) {
      normalizedValues.set(stockIndex, new Map<IndicatorField, number>());
    }

    for (const field of fields) {
      const values: number[] = [];
      for (const indicatorValues of stockIndicatorValues.values()) {
        const value = indicatorValues.get(field);
        if (typeof value === "number" && Number.isFinite(value)) {
          values.push(value);
        }
      }

      if (values.length === 0) {
        for (const normalizedMap of normalizedValues.values()) {
          normalizedMap.set(field, 0);
        }
        continue;
      }

      const direction = config.getDirection(field);
      if (config.normalizationMethod === NormalizationMethod.Z_SCORE) {
        this.normalizeFieldByZScore(
          stockIndicatorValues,
          normalizedValues,
          field,
          values,
          direction,
        );
        continue;
      }

      this.normalizeFieldByMinMax(
        stockIndicatorValues,
        normalizedValues,
        field,
        values,
        direction,
      );
    }

    return normalizedValues;
  }

  /**
   * MIN_MAX 归一化
   */
  private normalizeFieldByMinMax(
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    normalizedValues: Map<number, Map<IndicatorField, number>>,
    field: IndicatorField,
    values: number[],
    direction: ScoringDirection,
  ): void {
    const min = Math.min(...values);
    const max = Math.max(...values);

    for (const [
      stockIndex,
      indicatorValues,
    ] of stockIndicatorValues.entries()) {
      const value = indicatorValues.get(field);
      const normalizedMap = normalizedValues.get(stockIndex);
      if (!normalizedMap) {
        continue;
      }

      if (typeof value !== "number" || !Number.isFinite(value)) {
        normalizedMap.set(field, 0);
        continue;
      }

      const normalizedRaw = max === min ? 1 : (value - min) / (max - min);
      normalizedMap.set(
        field,
        this.applyDirection(this.clampToUnitInterval(normalizedRaw), direction),
      );
    }
  }

  /**
   * Z_SCORE 标准化 + Sigmoid 压缩
   */
  private normalizeFieldByZScore(
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    normalizedValues: Map<number, Map<IndicatorField, number>>,
    field: IndicatorField,
    values: number[],
    direction: ScoringDirection,
  ): void {
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance =
      values.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
      values.length;
    const std = Math.sqrt(variance);

    for (const [
      stockIndex,
      indicatorValues,
    ] of stockIndicatorValues.entries()) {
      const value = indicatorValues.get(field);
      const normalizedMap = normalizedValues.get(stockIndex);
      if (!normalizedMap) {
        continue;
      }

      if (typeof value !== "number" || !Number.isFinite(value)) {
        normalizedMap.set(field, 0);
        continue;
      }

      const normalizedRaw =
        std === 0 ? 1 : 1 / (1 + Math.exp(-(value - mean) / std));
      normalizedMap.set(
        field,
        this.applyDirection(this.clampToUnitInterval(normalizedRaw), direction),
      );
    }
  }

  /**
   * 计算加权总分并构建 ScoredStock
   */
  private calculateWeightedScores(
    stocks: Stock[],
    normalizedValues: Map<number, Map<IndicatorField, number>>,
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    config: ScoringConfig,
  ): ScoredStock[] {
    const scoredStocks: ScoredStock[] = [];

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const normalizedMap = normalizedValues.get(i);
      const indicatorValuesMap = stockIndicatorValues.get(i);
      if (!stock || !normalizedMap || !indicatorValuesMap) {
        continue;
      }

      let totalScore = 0;
      const scoreBreakdown = new Map<IndicatorField, number>();
      const scoreContributions = new Map<IndicatorField, number>();
      const indicatorValues = new Map<IndicatorField, unknown>();
      const scoreExplanations: string[] = [];

      for (const field of config.getFields()) {
        const normalizedScore = normalizedMap.get(field) ?? 0;
        const weight = config.getWeight(field);
        const contribution = normalizedScore * weight;
        const rawValue = indicatorValuesMap.get(field) ?? null;
        const direction = config.getDirection(field);

        totalScore += contribution;
        scoreBreakdown.set(field, normalizedScore);
        scoreContributions.set(field, contribution);
        indicatorValues.set(field, rawValue);

        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
          scoreExplanations.push(
            `${field}: raw=${rawValue}, normalized=${normalizedScore.toFixed(
              4,
            )}, weight=${weight.toFixed(4)}, direction=${direction}, contribution=${contribution.toFixed(
              4,
            )}`,
          );
        } else {
          scoreExplanations.push(
            `${field}: raw=missing, normalized=0.0000, weight=${weight.toFixed(
              4,
            )}, direction=${direction}, contribution=0.0000`,
          );
        }
      }

      totalScore = this.clampToUnitInterval(totalScore);

      scoredStocks.push(
        ScoredStock.create(
          stock.code,
          stock.name,
          totalScore,
          scoreBreakdown,
          indicatorValues,
          [],
          scoreContributions,
          scoreExplanations,
        ),
      );
    }

    return scoredStocks;
  }

  private applyDirection(
    normalized: number,
    direction: ScoringDirection,
  ): number {
    if (direction === ScoringDirection.DESC) {
      return this.clampToUnitInterval(1 - normalized);
    }
    return this.clampToUnitInterval(normalized);
  }

  private clampToUnitInterval(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
