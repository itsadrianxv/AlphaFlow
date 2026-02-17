/**
 * IScoringService 领域服务
 *
 * 负责股票评分计算，实现 MIN_MAX 归一化和加权求和。
 *
 * 评分流程：
 * 1. 对每只股票计算 ScoringConfig 中指定的指标值
 * 2. 对每个指标在所有股票中做 MIN_MAX 归一化：(value - min) / (max - min)
 * 3. 缺失指标的归一化得分设为 0
 * 4. 加权求和：score = Σ(归一化值 × 权重)
 *
 * Requirements: 3.4, 3.5
 */

import type { Stock } from "../entities/stock";
import type { ScoringConfig } from "../value-objects/scoring-config";
import type { IIndicatorCalculationService } from "./indicator-calculation-service.js";
import { ScoredStock, type MatchedCondition } from "../value-objects/scored-stock";
import type { IndicatorField } from "../enums/indicator-field";
import { ScoringError } from "../errors";

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
   *
   * @example
   * const scoredStocks = await service.scoreStocks(
   *   stocks,
   *   scoringConfig,
   *   indicatorCalcService
   * );
   * // 返回按 score 降序排列的 ScoredStock 列表
   */
  scoreStocks(
    stocks: Stock[],
    config: ScoringConfig,
    calcService: IIndicatorCalculationService
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
    calcService: IIndicatorCalculationService
  ): Promise<ScoredStock[]> {
    // 空列表直接返回
    if (stocks.length === 0) {
      return [];
    }

    // 获取需要评分的指标字段
    const fields = config.getFields();

    // 1. 计算所有股票的所有指标值
    const stockIndicatorValues = await this.calculateAllIndicators(
      stocks,
      fields,
      calcService
    );

    // 2. 对每个指标进行 MIN_MAX 归一化
    const normalizedValues = this.normalizeIndicators(
      stockIndicatorValues,
      fields
    );

    // 3. 计算加权总分并构建 ScoredStock
    const scoredStocks = this.calculateWeightedScores(
      stocks,
      normalizedValues,
      stockIndicatorValues,
      config
    );

    // 4. 按评分降序排列
    scoredStocks.sort((a, b) => b.score - a.score);

    return scoredStocks;
  }

  /**
   * 计算所有股票的所有指标值
   *
   * @param stocks 股票列表
   * @param fields 指标字段列表
   * @param calcService 指标计算服务
   * @returns 股票索引 -> 指标字段 -> 指标值的映射
   */
  private async calculateAllIndicators(
    stocks: Stock[],
    fields: IndicatorField[],
    calcService: IIndicatorCalculationService
  ): Promise<Map<number, Map<IndicatorField, number | string | null>>> {
    const result = new Map<
      number,
      Map<IndicatorField, number | string | null>
    >();

    // 并行计算所有股票的指标值
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
   * 对每个指标进行 MIN_MAX 归一化
   *
   * 归一化公式：(value - min) / (max - min)
   * - 缺失值（null）的归一化得分为 0
   * - 如果所有值都相同（max === min），归一化得分为 1
   * - 只处理数值型指标，文本型指标跳过
   *
   * @param stockIndicatorValues 股票索引 -> 指标字段 -> 指标值的映射
   * @param fields 指标字段列表
   * @returns 股票索引 -> 指标字段 -> 归一化得分的映射
   */
  private normalizeIndicators(
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    fields: IndicatorField[]
  ): Map<number, Map<IndicatorField, number>> {
    const normalizedValues = new Map<number, Map<IndicatorField, number>>();

    // 初始化每个股票的归一化值映射
    for (const stockIndex of stockIndicatorValues.keys()) {
      normalizedValues.set(stockIndex, new Map<IndicatorField, number>());
    }

    // 对每个指标进行归一化
    for (const field of fields) {
      // 收集该指标的所有有效数值
      const values: number[] = [];
      for (const indicatorValues of stockIndicatorValues.values()) {
        const value = indicatorValues.get(field);
        if (typeof value === "number" && Number.isFinite(value)) {
          values.push(value);
        }
      }

      // 如果没有有效值，所有股票该指标归一化得分为 0
      if (values.length === 0) {
        for (const normalizedMap of normalizedValues.values()) {
          normalizedMap.set(field, 0);
        }
        continue;
      }

      // 计算 min 和 max
      const min = Math.min(...values);
      const max = Math.max(...values);

      // 对每只股票进行归一化
      for (const [stockIndex, indicatorValues] of stockIndicatorValues.entries()) {
        const value = indicatorValues.get(field);
        const normalizedMap = normalizedValues.get(stockIndex)!;

        // 缺失值或非数值型，归一化得分为 0
        if (typeof value !== "number" || !Number.isFinite(value)) {
          normalizedMap.set(field, 0);
          continue;
        }

        // 如果所有值都相同（max === min），归一化得分为 1
        if (max === min) {
          normalizedMap.set(field, 1);
          continue;
        }

        // MIN_MAX 归一化：(value - min) / (max - min)
        const normalized = (value - min) / (max - min);
        normalizedMap.set(field, normalized);
      }
    }

    return normalizedValues;
  }

  /**
   * 计算加权总分并构建 ScoredStock
   *
   * 加权求和公式：score = Σ(归一化值 × 权重)
   *
   * @param stocks 股票列表
   * @param normalizedValues 股票索引 -> 指标字段 -> 归一化得分的映射
   * @param stockIndicatorValues 股票索引 -> 指标字段 -> 原始指标值的映射
   * @param config 评分配置
   * @returns ScoredStock 列表
   */
  private calculateWeightedScores(
    stocks: Stock[],
    normalizedValues: Map<number, Map<IndicatorField, number>>,
    stockIndicatorValues: Map<
      number,
      Map<IndicatorField, number | string | null>
    >,
    config: ScoringConfig
  ): ScoredStock[] {
    const scoredStocks: ScoredStock[] = [];

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i]!;
      const normalizedMap = normalizedValues.get(i)!;
      const indicatorValuesMap = stockIndicatorValues.get(i)!;

      // 计算加权总分
      let totalScore = 0;
      for (const field of config.getFields()) {
        const normalizedScore = normalizedMap.get(field) ?? 0;
        const weight = config.getWeight(field);
        totalScore += normalizedScore * weight;
      }

      // 确保总分在 [0, 1] 区间内（处理浮点精度问题）
      totalScore = Math.max(0, Math.min(1, totalScore));

      // 构建 scoreBreakdown 和 indicatorValues
      const scoreBreakdown = new Map<IndicatorField, number>();
      const indicatorValues = new Map<IndicatorField, unknown>();

      for (const field of config.getFields()) {
        scoreBreakdown.set(field, normalizedMap.get(field) ?? 0);
        indicatorValues.set(field, indicatorValuesMap.get(field) ?? null);
      }

      // 创建 ScoredStock（matchedConditions 为空数组，由上层填充）
      const scoredStock = ScoredStock.create(
        stock.code,
        stock.name,
        totalScore,
        scoreBreakdown,
        indicatorValues,
        []
      );

      scoredStocks.push(scoredStock);
    }

    return scoredStocks;
  }
}
