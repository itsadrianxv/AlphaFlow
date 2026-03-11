/**
 * IIndicatorCalculationService 领域服务
 *
 * 负责计算各类指标值，根据指标类别路由到不同的计算逻辑：
 * - BASIC: 直接从 Stock 实体获取
 * - TIME_SERIES: 从 IHistoricalDataProvider 获取历史数据并计算
 * - DERIVED: 使用硬编码公式从基础指标计算
 *
 * Requirements: 3.2
 */

import type { Stock } from "../entities/stock";
import { IndicatorField } from "../enums/indicator-field";
import type { IHistoricalDataProvider } from "../repositories/historical-data-provider";
import {
  getIndicatorCategory,
  getIndicatorFieldMetadata,
} from "../enums/indicator-field";
import { IndicatorCategory } from "../enums/indicator-category";
import { IndicatorCalculationError } from "../errors";

/**
 * 指标计算服务接口
 */
export interface IIndicatorCalculationService {
  /**
   * 计算单个指标值
   *
   * @param indicator 指标字段
   * @param stock 股票实体
   * @returns 指标值（数值或文本），计算失败返回 null
   *
   * @example
   * const roe = await service.calculateIndicator(IndicatorField.ROE, stock);
   * const peg = await service.calculateIndicator(IndicatorField.PEG, stock);
   */
  calculateIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): Promise<number | string | null>;

  /**
   * 批量计算多个指标值
   *
   * @param indicators 指标字段列表
   * @param stock 股票实体
   * @returns 指标值映射表
   *
   * @example
   * const values = await service.calculateBatch(
   *   [IndicatorField.ROE, IndicatorField.PE, IndicatorField.PEG],
   *   stock
   * );
   * // 返回: Map { ROE => 0.28, PE => 35.5, PEG => 1.2 }
   */
  calculateBatch(
    indicators: IndicatorField[],
    stock: Stock
  ): Promise<Map<IndicatorField, number | string | null>>;

  /**
   * 验证衍生指标是否可计算
   *
   * @param indicator 指标字段
   * @returns 验证结果 { valid: boolean, reason?: string }
   */
  validateDerivedIndicator(indicator: IndicatorField): {
    valid: boolean;
    reason?: string;
  };
}

/**
 * 指标计算服务实现
 */
export class IndicatorCalculationService
  implements IIndicatorCalculationService
{
  constructor(
    private readonly historicalDataProvider: IHistoricalDataProvider
  ) {}

  /**
   * 计算单个指标值
   */
  async calculateIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): Promise<number | string | null> {
    const category = getIndicatorCategory(indicator);

    try {
      switch (category) {
        case IndicatorCategory.BASIC:
          return this.calculateBasicIndicator(indicator, stock);

        case IndicatorCategory.TIME_SERIES:
          return await this.calculateTimeSeriesIndicator(indicator, stock);

        case IndicatorCategory.DERIVED:
          return this.calculateDerivedIndicator(indicator, stock);

        default:
          return null;
      }
    } catch (error) {
      // 计算失败返回 null，由上层处理
      if (error instanceof IndicatorCalculationError) {
        console.warn(error.message);
      }
      return null;
    }
  }

  /**
   * 批量计算多个指标值
   */
  async calculateBatch(
    indicators: IndicatorField[],
    stock: Stock
  ): Promise<Map<IndicatorField, number | string | null>> {
    const result = new Map<IndicatorField, number | string | null>();

    // 并行计算所有指标
    const promises = indicators.map(async (indicator) => {
      const value = await this.calculateIndicator(indicator, stock);
      return { indicator, value };
    });

    const results = await Promise.all(promises);

    for (const { indicator, value } of results) {
      result.set(indicator, value);
    }

    return result;
  }

  /**
   * 验证衍生指标是否可计算
   */
  validateDerivedIndicator(indicator: IndicatorField): {
    valid: boolean;
    reason?: string;
  } {
    const category = getIndicatorCategory(indicator);

    if (category !== IndicatorCategory.DERIVED) {
      return {
        valid: false,
        reason: `指标 ${indicator} 不是衍生指标`,
      };
    }

    // 所有已定义的衍生指标都是可计算的
    return { valid: true };
  }

  /**
   * 计算基础指标（BASIC）
   * 直接从 Stock 实体获取
   */
  private calculateBasicIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): number | string | null {
    return stock.getValue(indicator);
  }

  /**
   * 计算时间序列指标（TIME_SERIES）
   * 从 IHistoricalDataProvider 获取历史数据并计算
   */
  private async calculateTimeSeriesIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): Promise<number | null> {
    switch (indicator) {
      case IndicatorField.REVENUE_CAGR_3Y:
        return await this.calculateCAGR(stock, IndicatorField.REVENUE, 3);

      case IndicatorField.NET_PROFIT_CAGR_3Y:
        return await this.calculateCAGR(stock, IndicatorField.NET_PROFIT, 3);

      case IndicatorField.ROE_AVG_3Y:
        return await this.calculateAverage(stock, IndicatorField.ROE, 3);

      default:
        throw new IndicatorCalculationError(
          indicator,
          "未知的时间序列指标"
        );
    }
  }

  /**
   * 计算衍生指标（DERIVED）
   * 使用硬编码公式从基础指标计算
   */
  private calculateDerivedIndicator(
    indicator: IndicatorField,
    stock: Stock
  ): number | null {
    switch (indicator) {
      case IndicatorField.PEG:
        return this.calculatePEG(stock);

      case IndicatorField.ROE_MINUS_DEBT:
        return this.calculateROEMinusDebt(stock);

      default:
        throw new IndicatorCalculationError(indicator, "未知的衍生指标");
    }
  }

  /**
   * 计算复合年增长率（CAGR）
   *
   * 公式: CAGR = (结束值 / 起始值)^(1/年数) - 1
   *
   * @param stock 股票实体
   * @param baseIndicator 基础指标（REVENUE 或 NET_PROFIT）
   * @param years 年数
   * @returns CAGR 值（百分比形式，如 0.15 表示 15%），计算失败返回 null
   */
  private async calculateCAGR(
    stock: Stock,
    baseIndicator: IndicatorField,
    years: number
  ): Promise<number | null> {
    try {
      const dataPoints = await this.historicalDataProvider.getIndicatorHistory(
        stock.code,
        baseIndicator,
        years + 1
      );

      // 需要至少 years + 1 个数据点（包括起始年和结束年）
      if (dataPoints.length < years + 1) {
        return null;
      }

      const startPoint = dataPoints[0];
      const endPoint = dataPoints[dataPoints.length - 1];

      if (!startPoint || !endPoint) {
        return null;
      }

      const startValue = startPoint.value;
      const endValue = endPoint.value;

      // 起始值必须大于 0
      if (startValue === null || endValue === null || startValue <= 0) {
        return null;
      }

      // 计算 CAGR
      const cagr = Math.pow(endValue / startValue, 1 / years) - 1;

      // 返回百分比形式（如 0.15 表示 15%）
      return cagr;
    } catch (error) {
      throw new IndicatorCalculationError(
        `${baseIndicator}_CAGR_${years}Y`,
        `历史数据获取失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 计算平均值
   *
   * @param stock 股票实体
   * @param baseIndicator 基础指标
   * @param years 年数
   * @returns 平均值，计算失败返回 null
   */
  private async calculateAverage(
    stock: Stock,
    baseIndicator: IndicatorField,
    years: number
  ): Promise<number | null> {
    try {
      const dataPoints = await this.historicalDataProvider.getIndicatorHistory(
        stock.code,
        baseIndicator,
        years
      );

      if (dataPoints.length === 0) {
        return null;
      }

      const validValues = dataPoints
        .map((point) => point.value)
        .filter((value): value is number =>
          typeof value === "number" && Number.isFinite(value)
        );

      if (validValues.length === 0) {
        return null;
      }

      const sum = validValues.reduce((acc, value) => acc + value, 0);
      const average = sum / validValues.length;

      return average;
    } catch (error) {
      throw new IndicatorCalculationError(
        `${baseIndicator}_AVG_${years}Y`,
        `历史数据获取失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 计算 PEG（市盈率相对盈利增长比率）
   *
   * 公式: PEG = PE / (ROE × 100)
   *
   * 注意：这是一个简化公式。标准 PEG 公式使用净利润增长率，但由于 DERIVED 类别
   * 的定义是仅从基础指标计算（不依赖历史数据），我们使用 ROE 作为盈利能力的代理指标。
   *
   * PEG < 1: 可能被低估
   * PEG = 1: 合理估值
   * PEG > 1: 可能被高估
   *
   * @param stock 股票实体
   * @returns PEG 值，计算失败返回 null
   */
  private calculatePEG(stock: Stock): number | null {
    const pe = stock.pe;
    const roe = stock.roe;

    // PE 和 ROE 必须存在且大于 0
    if (pe === null || pe <= 0 || roe === null || roe <= 0) {
      return null;
    }

    // 简化公式：PEG = PE / (ROE × 100)
    // ROE 反映盈利能力，可作为增长潜力的代理指标
    const peg = pe / (roe * 100);
    return peg;
  }

  /**
   * 计算 ROE 与负债率之差
   *
   * 公式: ROE_MINUS_DEBT = ROE - DEBT_RATIO
   *
   * 该指标用于评估企业在考虑负债风险后的真实盈利能力。
   * 值越高，说明企业在低负债情况下仍能保持高 ROE。
   *
   * @param stock 股票实体
   * @returns ROE 与负债率之差（百分比形式），计算失败返回 null
   */
  private calculateROEMinusDebt(stock: Stock): number | null {
    const roe = stock.roe;
    const debtRatio = stock.debtRatio;

    // ROE 和负债率必须都存在
    if (roe === null || debtRatio === null) {
      return null;
    }

    return roe - debtRatio;
  }
}
