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

import { IndicatorField, isNumericIndicator } from "../enums/indicator-field";

/**
 * 归一化方法枚举
 */
export enum NormalizationMethod {
  /** MIN-MAX 归一化：(value - min) / (max - min) */
  MIN_MAX = "MIN_MAX",
  /** Z-Score 标准化后使用 Sigmoid 压缩到 (0, 1) */
  Z_SCORE = "Z_SCORE",
}

/**
 * 评分方向
 */
export enum ScoringDirection {
  /** 值越大得分越高 */
  ASC = "ASC",
  /** 值越小得分越高 */
  DESC = "DESC",
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
  private readonly _directions: ReadonlyMap<IndicatorField, ScoringDirection>;
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
    normalizationMethod: NormalizationMethod,
    directions?: Map<IndicatorField, ScoringDirection>,
  ) {
    this._weights = new Map(weights);
    this._directions = ScoringConfig.resolveDirections(weights, directions);
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
   * 获取评分方向映射
   */
  get directions(): ReadonlyMap<IndicatorField, ScoringDirection> {
    return this._directions;
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
    normalizationMethod: NormalizationMethod = NormalizationMethod.MIN_MAX,
    directions?: Map<IndicatorField, ScoringDirection>,
  ): ScoringConfig {
    const validation = ScoringConfig.validate(weights, directions);
    if (!validation.isValid) {
      throw new InvalidScoringConfigError(
        validation.error ?? "未知评分配置错误",
      );
    }
    return new ScoringConfig(weights, normalizationMethod, directions);
  }

  /**
   * 尝试创建 ScoringConfig 实例，不抛出异常
   * @param weights 指标权重映射
   * @param normalizationMethod 归一化方法
   * @returns ScoringConfig 实例或 null
   */
  static tryCreate(
    weights: Map<IndicatorField, number>,
    normalizationMethod: NormalizationMethod = NormalizationMethod.MIN_MAX,
    directions?: Map<IndicatorField, ScoringDirection>,
  ): ScoringConfig | null {
    const validation = ScoringConfig.validate(weights, directions);
    if (!validation.isValid) {
      return null;
    }
    return new ScoringConfig(weights, normalizationMethod, directions);
  }

  /**
   * 验证权重配置
   * @param weights 指标权重映射
   * @returns 验证结果
   */
  static validate(
    weights: Map<IndicatorField, number>,
    directions?: Map<IndicatorField, ScoringDirection>,
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
      if (!isNumericIndicator(field)) {
        return {
          isValid: false,
          error: `指标 ${field} 为文本型指标，不能用于数值评分`,
        };
      }
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

    // 检查方向配置
    if (directions) {
      for (const [field, direction] of directions.entries()) {
        if (!weights.has(field)) {
          return {
            isValid: false,
            error: `指标 ${field} 未配置权重，不能单独配置评分方向`,
          };
        }

        if (!Object.values(ScoringDirection).includes(direction)) {
          return {
            isValid: false,
            error: `指标 ${field} 的评分方向无效: ${String(direction)}`,
          };
        }
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
   * 获取指定指标的评分方向
   * @param field 指标字段
   * @returns 评分方向，未显式配置时默认 ASC
   */
  getDirection(field: IndicatorField): ScoringDirection {
    return this._directions.get(field) ?? ScoringDirection.ASC;
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

    const directionsObj: Record<string, ScoringDirection> = {};
    for (const [field, direction] of this._directions.entries()) {
      directionsObj[field] = direction;
    }

    return {
      weights: weightsObj,
      directions: directionsObj,
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
        throw new Error(
          `指标 ${field} 的权重必须为数字，当前类型为 ${typeof weight}`,
        );
      }
      // 验证是否为有效的 IndicatorField
      if (!Object.values(IndicatorField).includes(field as IndicatorField)) {
        throw new Error(`未知的指标字段: ${field}`);
      }
      weights.set(field as IndicatorField, weight);
    }

    let directions: Map<IndicatorField, ScoringDirection> | undefined;
    if (data.directions !== undefined) {
      if (typeof data.directions !== "object" || data.directions === null) {
        throw new Error("ScoringConfig 的 directions 必须为对象");
      }

      const directionsObj = data.directions as Record<string, string>;
      directions = new Map<IndicatorField, ScoringDirection>();
      for (const [field, direction] of Object.entries(directionsObj)) {
        if (!Object.values(IndicatorField).includes(field as IndicatorField)) {
          throw new Error(`未知的指标字段: ${field}`);
        }
        if (
          !Object.values(ScoringDirection).includes(
            direction as ScoringDirection,
          )
        ) {
          throw new Error(`指标 ${field} 的评分方向无效: ${direction}`);
        }
        directions.set(field as IndicatorField, direction as ScoringDirection);
      }
    }

    const normalizationMethod =
      (data.normalizationMethod as NormalizationMethod) ??
      NormalizationMethod.MIN_MAX;

    // 验证归一化方法
    if (!Object.values(NormalizationMethod).includes(normalizationMethod)) {
      throw new Error(`未知的归一化方法: ${normalizationMethod}`);
    }

    return ScoringConfig.create(weights, normalizationMethod, directions);
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

    for (const field of this._weights.keys()) {
      if (this.getDirection(field) !== other.getDirection(field)) {
        return false;
      }
    }

    return true;
  }

  private static resolveDirections(
    weights: Map<IndicatorField, number>,
    directions?: Map<IndicatorField, ScoringDirection>,
  ): ReadonlyMap<IndicatorField, ScoringDirection> {
    const resolved = new Map<IndicatorField, ScoringDirection>();
    for (const field of weights.keys()) {
      resolved.set(field, directions?.get(field) ?? ScoringDirection.ASC);
    }
    return resolved;
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
