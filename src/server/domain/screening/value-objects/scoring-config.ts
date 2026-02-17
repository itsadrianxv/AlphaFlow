/**
 * ScoringConfig 值对象
 *
 * 定义股票评分的权重配置和归一化方法。
 *
 * 业务不变量：
 * - 权重之和必须等于 1.0（±0.001 精度）
 * - 所有权重必须为正数
 * - 至少包含一个指标权重
 *
 * @example
 * const config = ScoringConfig.create(
 *   new Map([
 *     [IndicatorField.ROE, 0.3],
 *     [IndicatorField.PE, 0.2],
 *     [IndicatorField.REVENUE_CAGR_3Y, 0.5],
 *   ]),
 *   NormalizationMethod.MIN_MAX
 * );
 */

import { IndicatorField } from "../enums/indicator-field";

/**
 * 归一化方法枚举
 */
export enum NormalizationMethod {
  /** MIN-MAX 归一化：(value - min) / (max - min) */
  MIN_MAX = "MIN_MAX",
}

/**
 * 评分配置验证结果
 */
export interface ScoringConfigValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * 评分配置值对象
 */
export class ScoringConfig {
  private readonly _weights: ReadonlyMap<IndicatorField, number>;
  private readonly _normalizationMethod: NormalizationMethod;

  /**
   * 权重之和的允许误差（浮点精度）
   */
  private static readonly WEIGHT_SUM_TOLERANCE = 0.001;

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   */
  private constructor(
    weights: Map<IndicatorField, number>,
    normalizationMethod: NormalizationMethod
  ) {
    this._weights = new Map(weights);
    this._normalizationMethod = normalizationMethod;
  }

  /**
   * 获取权重映射
   */
  get weights(): ReadonlyMap<IndicatorField, number> {
    return this._weights;
  }

  /**
   * 获取归一化方法
   */
  get normalizationMethod(): NormalizationMethod {
    return this._normalizationMethod;
  }

  /**
   * 创建 ScoringConfig 实例
   * @param weights 指标权重映射
   * @param normalizationMethod 归一化方法
   * @returns ScoringConfig 实例
   * @throws InvalidScoringConfigError 如果配置不符合业务不变量
   */
  static create(
    weights: Map<IndicatorField, number>,
    normalizationMethod: NormalizationMethod = NormalizationMethod.MIN_MAX
  ): ScoringConfig {
    const validation = ScoringConfig.validate(weights);
    if (!validation.isValid) {
      throw new InvalidScoringConfigError(validation.error!);
    }
    return new ScoringConfig(weights, normalizationMethod);
  }

  /**
   * 尝试创建 ScoringConfig 实例，不抛出异常
   * @param weights 指标权重映射
   * @param normalizationMethod 归一化方法
   * @returns ScoringConfig 实例或 null
   */
  static tryCreate(
    weights: Map<IndicatorField, number>,
    normalizationMethod: NormalizationMethod = NormalizationMethod.MIN_MAX
  ): ScoringConfig | null {
    const validation = ScoringConfig.validate(weights);
    if (!validation.isValid) {
      return null;
    }
    return new ScoringConfig(weights, normalizationMethod);
  }

  /**
   * 验证权重配置
   * @param weights 指标权重映射
   * @returns 验证结果
   */
  static validate(
    weights: Map<IndicatorField, number>
  ): ScoringConfigValidationResult {
    // 检查是否为空
    if (weights.size === 0) {
      return {
        isValid: false,
        error: "评分配置必须至少包含一个指标权重",
      };
    }

    // 检查所有权重是否为正数
    for (const [field, weight] of weights.entries()) {
      if (weight <= 0) {
        return {
          isValid: false,
          error: `指标 ${field} 的权重必须为正数，当前值为 ${weight}`,
        };
      }
      if (!Number.isFinite(weight)) {
        return {
          isValid: false,
          error: `指标 ${field} 的权重必须为有限数值，当前值为 ${weight}`,
        };
      }
    }

    // 检查权重之和是否等于 1.0（±0.001 精度）
    const sum = Array.from(weights.values()).reduce((acc, w) => acc + w, 0);
    const deviation = Math.abs(sum - 1.0);
    if (deviation > ScoringConfig.WEIGHT_SUM_TOLERANCE) {
      return {
        isValid: false,
        error: `权重之和必须等于 1.0（±0.001），当前和为 ${sum}，偏差为 ${deviation.toFixed(6)}`,
      };
    }

    return { isValid: true };
  }

  /**
   * 获取指定指标的权重
   * @param field 指标字段
   * @returns 权重值，如果不存在则返回 0
   */
  getWeight(field: IndicatorField): number {
    return this._weights.get(field) ?? 0;
  }

  /**
   * 获取所有指标字段
   * @returns 指标字段数组
   */
  getFields(): IndicatorField[] {
    return Array.from(this._weights.keys());
  }

  /**
   * 判断是否包含指定指标
   * @param field 指标字段
   * @returns 是否包含
   */
  hasField(field: IndicatorField): boolean {
    return this._weights.has(field);
  }

  /**
   * 获取权重数量
   * @returns 权重数量
   */
  size(): number {
    return this._weights.size;
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    const weightsObj: Record<string, number> = {};
    for (const [field, weight] of this._weights.entries()) {
      weightsObj[field] = weight;
    }

    return {
      weights: weightsObj,
      normalizationMethod: this._normalizationMethod,
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns ScoringConfig 实例
   * @throws Error 如果数据格式无效
   */
  static fromDict(data: Record<string, unknown>): ScoringConfig {
    if (!data.weights || typeof data.weights !== "object") {
      throw new Error("ScoringConfig 数据必须包含 weights 对象");
    }

    const weightsObj = data.weights as Record<string, number>;
    const weights = new Map<IndicatorField, number>();

    for (const [field, weight] of Object.entries(weightsObj)) {
      if (typeof weight !== "number") {
        throw new Error(`指标 ${field} 的权重必须为数字，当前类型为 ${typeof weight}`);
      }
      // 验证是否为有效的 IndicatorField
      if (!Object.values(IndicatorField).includes(field as IndicatorField)) {
        throw new Error(`未知的指标字段: ${field}`);
      }
      weights.set(field as IndicatorField, weight);
    }

    const normalizationMethod =
      (data.normalizationMethod as NormalizationMethod) ??
      NormalizationMethod.MIN_MAX;

    // 验证归一化方法
    if (!Object.values(NormalizationMethod).includes(normalizationMethod)) {
      throw new Error(`未知的归一化方法: ${normalizationMethod}`);
    }

    return ScoringConfig.create(weights, normalizationMethod);
  }

  /**
   * 判断两个 ScoringConfig 是否相等
   * @param other 另一个 ScoringConfig
   * @returns 是否相等
   */
  equals(other: ScoringConfig | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }

    if (this._normalizationMethod !== other._normalizationMethod) {
      return false;
    }

    if (this._weights.size !== other._weights.size) {
      return false;
    }

    for (const [field, weight] of this._weights.entries()) {
      const otherWeight = other._weights.get(field);
      if (otherWeight === undefined || Math.abs(weight - otherWeight) > 1e-10) {
        return false;
      }
    }

    return true;
  }
}

/**
 * 无效评分配置错误
 */
export class InvalidScoringConfigError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`无效的评分配置: ${reason}`);
    this.name = "InvalidScoringConfigError";
    this.reason = reason;
  }
}
