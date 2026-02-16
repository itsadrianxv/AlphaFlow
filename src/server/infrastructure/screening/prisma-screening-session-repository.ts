/**
 * PrismaScreeningSessionRepository 实现
 *
 * 基于 Prisma ORM 实现 IScreeningSessionRepository 接口。
 * 负责 ScreeningSession 聚合根的持久化操作，处理领域对象与数据库模型之间的映射。
 *
 * 核心职责：
 * - 将 ScreeningSession 聚合根序列化为 Prisma 模型
 * - 将 Prisma 模型反序列化为 ScreeningSession 聚合根
 * - 处理 topStocks、filtersSnapshot 和 scoringConfigSnapshot 的 JSON 序列化/反序列化
 * - 提供 CRUD 和查询操作
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import type { PrismaClient } from "../../../../generated/prisma/index.js";
import type { IScreeningSessionRepository } from "../../domain/screening/repositories/screening-session-repository.js";
import { ScreeningSession } from "../../domain/screening/aggregates/screening-session.js";
import { ScoredStock } from "../../domain/screening/value-objects/scored-stock.js";
import { StockCode } from "../../domain/screening/value-objects/stock-code.js";
import { FilterGroup } from "../../domain/screening/entities/filter-group.js";
import { ScoringConfig } from "../../domain/screening/value-objects/scoring-config.js";

/**
 * Prisma 实现的筛选会话仓储
 */
export class PrismaScreeningSessionRepository
  implements IScreeningSessionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 保存会话（创建或更新）
   * @param session 筛选会话
   */
  async save(session: ScreeningSession): Promise<void> {
    const data = {
      strategyId: session.strategyId,
      strategyName: session.strategyName,
      executedAt: session.executedAt,
      totalScanned: session.totalScanned,
      executionTime: session.executionTime,
      topStocks: session.topStocks.map((stock) => stock.toDict()) as object[],
      otherStockCodes: session.otherStockCodes.map((code) => code.value),
      filtersSnapshot: session.filtersSnapshot.toDict() as object,
      scoringConfigSnapshot: session.scoringConfigSnapshot.toDict() as object,
      userId: session.userId,
    };

    await this.prisma.screeningSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        ...data,
      },
      update: data,
    });
  }

  /**
   * 根据 ID 查找会话
   * @param id 会话 ID
   * @returns 会话实例或 null
   */
  async findById(id: string): Promise<ScreeningSession | null> {
    const record = await this.prisma.screeningSession.findUnique({
      where: { id },
    });

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  /**
   * 删除会话
   * @param id 会话 ID
   */
  async delete(id: string): Promise<void> {
    await this.prisma.screeningSession.delete({
      where: { id },
    });
  }

  /**
   * 根据策略 ID 查找会话列表
   * @param strategyId 策略 ID
   * @param limit 限制数量（可选）
   * @returns 会话列表
   */
  async findByStrategy(
    strategyId: string,
    limit?: number
  ): Promise<ScreeningSession[]> {
    const records = await this.prisma.screeningSession.findMany({
      where: { strategyId },
      take: limit,
      orderBy: { executedAt: "desc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 查找最近的会话列表（按执行时间降序）
   * @param limit 限制数量（可选）
   * @returns 会话列表
   */
  async findRecentSessions(limit?: number): Promise<ScreeningSession[]> {
    const records = await this.prisma.screeningSession.findMany({
      take: limit,
      orderBy: { executedAt: "desc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 将 Prisma 记录转换为领域对象
   * @param record Prisma 记录
   * @returns ScreeningSession 实例
   */
  private toDomain(record: {
    id: string;
    strategyId: string | null;
    strategyName: string;
    executedAt: Date;
    totalScanned: number;
    executionTime: number;
    topStocks: unknown;
    otherStockCodes: string[];
    filtersSnapshot: unknown;
    scoringConfigSnapshot: unknown;
    userId: string;
  }): ScreeningSession {
    // 反序列化 topStocks
    const topStocksData = record.topStocks as Record<string, unknown>[];
    const topStocks = topStocksData.map((stockData) =>
      ScoredStock.fromDict(stockData)
    );

    // 反序列化 otherStockCodes
    const otherStockCodes = record.otherStockCodes.map((code) =>
      StockCode.create(code)
    );

    // 反序列化 filtersSnapshot
    const filtersSnapshot = FilterGroup.fromDict(
      record.filtersSnapshot as Record<string, unknown>
    );

    // 反序列化 scoringConfigSnapshot
    const scoringConfigSnapshot = ScoringConfig.fromDict(
      record.scoringConfigSnapshot as Record<string, unknown>
    );

    // 使用 fromDict 方法重建 ScreeningSession
    return ScreeningSession.fromDict({
      id: record.id,
      strategyId: record.strategyId,
      strategyName: record.strategyName,
      executedAt: record.executedAt.toISOString(),
      totalScanned: record.totalScanned,
      executionTime: record.executionTime,
      topStocks: topStocks.map((stock) => stock.toDict()),
      otherStockCodes: otherStockCodes.map((code) => code.value),
      filtersSnapshot: filtersSnapshot.toDict(),
      scoringConfigSnapshot: scoringConfigSnapshot.toDict(),
      userId: record.userId,
    });
  }
}
