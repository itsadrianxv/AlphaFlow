/**
 * ScreeningStrategy 聚合根
 *
 * 定义完整的股票筛选策略，包含筛选条件组和评分配置。
 * 作为聚合根，ScreeningStrategy 负责维护业务不变量并编排筛选执行流程。
 *
 * 业务不变量：
 * - name 非空
 * - filters 至少包含一个有效条件
 * - scoringConfig 权重之和等于 1.0（±0.001 精度）
 *
 * 核心行为：
 * - execute: 编排筛选流程（过滤 → 评分 → 排序）
 * - markAsTemplate: 标记为模板策略
 * - cloneWithModifications: 基于模板创建新策略（深拷贝）
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 3.1
 */

import { v4 as uuidv4 } from "uuid";
import { FilterGroup } from "../entities/filter-group";
import type { Stock } from "../entities/stock";
import { InvalidStrategyError } from "../errors";
import type { IIndicatorCalculationService } from "../services/indicator-calculation-service";
import type { ScoredStock } from "../value-objects/scored-stock";
import { ScoringConfig } from "../value-objects/scoring-config";
import { ScreeningResult } from "../value-objects/screening-result";

// Re-export IIndicatorCalculationService for convenience
export type { IIndicatorCalculationService } from "../services/indicator-calculation-service";

/**
 * IScoringService 接口
 * 负责股票评分计算
 */
export interface IScoringService {
  scoreStocks(
    stocks: Stock[],
    config: ScoringConfig,
    calcService: IIndicatorCalculationService,
  ): Promise<ScoredStock[]>;
}

/**
 * ScreeningStrategy 创建参数
 */
export interface CreateScreeningStrategyParams {
  name: string;
  description?: string;
  filters: FilterGroup;
  scoringConfig: ScoringConfig;
  tags?: string[];
  isTemplate?: boolean;
  userId: string;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * ScreeningStrategy 更新参数
 */
export interface UpdateScreeningStrategyParams {
  name?: string;
  description?: string;
  filters?: FilterGroup;
  scoringConfig?: ScoringConfig;
  tags?: string[];
}

/**
 * ScreeningStrategy 聚合根
 */
export class ScreeningStrategy {
  private readonly _id: string;
  private _name: string;
  private _description: string;
  private _filters: FilterGroup;
  private _scoringConfig: ScoringConfig;
  private _tags: string[];
  private _isTemplate: boolean;
  private readonly _userId: string;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(params: CreateScreeningStrategyParams) {
    this._id = params.id ?? uuidv4();
    this._name = params.name;
    this._description = params.description ?? "";
    this._filters = params.filters;
    this._scoringConfig = params.scoringConfig;
    this._tags = params.tags ?? [];
    this._isTemplate = params.isTemplate ?? false;
    this._userId = params.userId;
    this._createdAt = params.createdAt ?? new Date();
    this._updatedAt = params.updatedAt ?? new Date();
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

  get filters(): FilterGroup {
    return this._filters;
  }

  get scoringConfig(): ScoringConfig {
    return this._scoringConfig;
  }

  get tags(): readonly string[] {
    return this._tags;
  }

  get isTemplate(): boolean {
    return this._isTemplate;
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

  static create(params: CreateScreeningStrategyParams): ScreeningStrategy {
    const strategy = new ScreeningStrategy(params);
    strategy.validateInvariants();
    return strategy;
  }

  update(params: UpdateScreeningStrategyParams): void {
    // 保存当前状态以便回滚
    const originalName = this._name;
    const originalDescription = this._description;
    const originalFilters = this._filters;
    const originalScoringConfig = this._scoringConfig;
    const originalTags = this._tags;

    try {
      // 应用更新
      if (params.name !== undefined) {
        this._name = params.name;
      }
      if (params.description !== undefined) {
        this._description = params.description;
      }
      if (params.filters !== undefined) {
        this._filters = params.filters;
      }
      if (params.scoringConfig !== undefined) {
        this._scoringConfig = params.scoringConfig;
      }
      if (params.tags !== undefined) {
        this._tags = params.tags;
      }

      // 验证不变量
      this.validateInvariants();

      // 验证通过，更新时间戳
      this._updatedAt = new Date();
    } catch (error) {
      // 验证失败，回滚所有更改
      this._name = originalName;
      this._description = originalDescription;
      this._filters = originalFilters;
      this._scoringConfig = originalScoringConfig;
      this._tags = originalTags;
      throw error;
    }
  }

  markAsTemplate(): void {
    this._isTemplate = true;
    this._updatedAt = new Date();
  }

  cloneWithModifications(
    newName: string,
    userId: string,
    modifications?: Partial<UpdateScreeningStrategyParams>,
  ): ScreeningStrategy {
    const clonedFilters = FilterGroup.fromDict(this._filters.toDict());
    const clonedScoringConfig = ScoringConfig.fromDict(
      this._scoringConfig.toDict(),
    );

    return ScreeningStrategy.create({
      name: newName,
      description: modifications?.description ?? this._description,
      filters: modifications?.filters ?? clonedFilters,
      scoringConfig: modifications?.scoringConfig ?? clonedScoringConfig,
      tags: modifications?.tags ?? [...this._tags],
      isTemplate: false,
      userId: userId,
    });
  }

  async execute(
    candidateStocks: Stock[],
    scoringService: IScoringService,
    calcService: IIndicatorCalculationService,
  ): Promise<ScreeningResult> {
    const startTime = performance.now();

    const matchResults = await Promise.all(
      candidateStocks.map(async (stock) => ({
        stock,
        matched: await this._filters.matchAsync(stock, calcService),
      })),
    );
    const matchedStocks = matchResults
      .filter((result) => result.matched)
      .map((result) => result.stock);

    const scoredStocks = await scoringService.scoreStocks(
      matchedStocks,
      this._scoringConfig,
      calcService,
    );

    scoredStocks.sort((a, b) => b.score - a.score);

    const endTime = performance.now();
    const executionTime = endTime - startTime;

    return ScreeningResult.create(
      scoredStocks,
      candidateStocks.length,
      executionTime,
    );
  }

  private validateInvariants(): void {
    if (!this._name || this._name.trim().length === 0) {
      throw new InvalidStrategyError("策略名称不能为空");
    }

    if (!this._filters.hasAnyCondition()) {
      throw new InvalidStrategyError("筛选条件组必须至少包含一个有效条件");
    }

    const validation = ScoringConfig.validate(
      new Map(this._scoringConfig.weights),
    );
    if (!validation.isValid) {
      throw new InvalidStrategyError(`评分配置无效: ${validation.error}`);
    }
  }

  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      name: this._name,
      description: this._description,
      filters: this._filters.toDict(),
      scoringConfig: this._scoringConfig.toDict(),
      tags: [...this._tags],
      isTemplate: this._isTemplate,
      userId: this._userId,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  static fromDict(data: Record<string, unknown>): ScreeningStrategy {
    return ScreeningStrategy.create({
      id: data.id as string,
      name: data.name as string,
      description: data.description as string,
      filters: FilterGroup.fromDict(data.filters as Record<string, unknown>),
      scoringConfig: ScoringConfig.fromDict(
        data.scoringConfig as Record<string, unknown>,
      ),
      tags: data.tags as string[],
      isTemplate: data.isTemplate as boolean,
      userId: data.userId as string,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
    });
  }

  equals(other: ScreeningStrategy | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }

  toString(): string {
    return `ScreeningStrategy(${this._id}, ${this._name})`;
  }
}
