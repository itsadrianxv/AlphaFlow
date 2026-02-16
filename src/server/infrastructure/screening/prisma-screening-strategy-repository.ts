/**
 * PrismaScreeningStrategyRepository 实现
 *
 * 基于 Prisma ORM 实现 IScreeningStrategyRepository 接口。
 * 负责 ScreeningStrategy 聚合根的持久化操作，处理领域对象与数据库模型之间的映射。
 *
 * 核心职责：
 * - 将 ScreeningStrategy 聚合根序列化为 Prisma 模型
 * - 将 Prisma 模型反序列化为 ScreeningStrategy 聚合根
 * - 处理 FilterGroup 和 ScoringConfig 的 JSON 序列化/反序列化
 * - 提供 CRUD 和查询操作
 *
 * Requirements: 1.1, 1.7
 */

import type { PrismaClient } from "../../../../generated/prisma/index.js";
import type { IScreeningStrategyRepository } from "../../domain/screening/repositories/screening-strategy-repository.js";
import { ScreeningStrategy } from "../../domain/screening/aggregates/screening-strategy.js";
import { FilterGroup } from "../../domain/screening/entities/filter-group.js";
import { ScoringConfig } from "../../domain/screening/value-objects/scoring-config.js";

/**
 * Prisma 实现的筛选策略仓储
 */
export class PrismaScreeningStrategyRepository
  implements IScreeningStrategyRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 保存策略（创建或更新）
   * @param strategy 筛选策略
   */
  async save(strategy: ScreeningStrategy): Promise<void> {
    const data = {
      name: strategy.name,
      description: strategy.description || null,
      filters: strategy.filters.toDict() as object,
      scoringConfig: strategy.scoringConfig.toDict() as object,
      tags: strategy.tags as string[],
      isTemplate: strategy.isTemplate,
      userId: strategy.userId,
      updatedAt: strategy.updatedAt,
    };

    await this.prisma.screeningStrategy.upsert({
      where: { id: strategy.id },
      create: {
        id: strategy.id,
        createdAt: strategy.createdAt,
        ...data,
      },
      update: data,
    });
  }

  /**
   * 根据 ID 查找策略
   * @param id 策略 ID
   * @returns 策略实例或 null
   */
  async findById(id: string): Promise<ScreeningStrategy | null> {
    const record = await this.prisma.screeningStrategy.findUnique({
      where: { id },
    });

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  /**
   * 删除策略
   * @param id 策略 ID
   */
  async delete(id: string): Promise<void> {
    await this.prisma.screeningStrategy.delete({
      where: { id },
    });
  }

  /**
   * 查找所有策略（支持分页）
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 策略列表
   */
  async findAll(limit?: number, offset?: number): Promise<ScreeningStrategy[]> {
    const records = await this.prisma.screeningStrategy.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 查找所有模板策略
   * @returns 模板策略列表
   */
  async findTemplates(): Promise<ScreeningStrategy[]> {
    const records = await this.prisma.screeningStrategy.findMany({
      where: { isTemplate: true },
      orderBy: { createdAt: "desc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 根据名称查找策略
   * @param name 策略名称
   * @returns 策略实例或 null
   */
  async findByName(name: string): Promise<ScreeningStrategy | null> {
    const record = await this.prisma.screeningStrategy.findFirst({
      where: { name },
    });

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  /**
   * 将 Prisma 记录转换为领域对象
   * @param record Prisma 记录
   * @returns ScreeningStrategy 实例
   */
  private toDomain(record: {
    id: string;
    name: string;
    description: string | null;
    filters: unknown;
    scoringConfig: unknown;
    tags: string[];
    isTemplate: boolean;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
  }): ScreeningStrategy {
    // 反序列化 FilterGroup
    const filters = FilterGroup.fromDict(
      record.filters as Record<string, unknown>
    );

    // 反序列化 ScoringConfig
    const scoringConfig = ScoringConfig.fromDict(
      record.scoringConfig as Record<string, unknown>
    );

    // 创建领域对象
    return ScreeningStrategy.create({
      id: record.id,
      name: record.name,
      description: record.description ?? undefined,
      filters,
      scoringConfig,
      tags: record.tags,
      isTemplate: record.isTemplate,
      userId: record.userId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
