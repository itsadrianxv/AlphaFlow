/**
 * PrismaWatchListRepository 实现
 *
 * 基于 Prisma ORM 实现 IWatchListRepository 接口。
 * 负责 WatchList 聚合根的持久化操作，处理领域对象与数据库模型之间的映射。
 *
 * 核心职责：
 * - 将 WatchList 聚合根序列化为 Prisma 模型
 * - 将 Prisma 模型反序列化为 WatchList 聚合根
 * - 处理 stocks 的 JSON 序列化/反序列化
 * - 提供 CRUD 和查询操作
 *
 * Requirements: 5.1
 */

import type { PrismaClient } from "@prisma/client";
import { WatchList } from "~/modules/screening/server/domain/aggregates/watch-list";
import type {
  IWatchListRepository,
  WatchListQueryOptions,
} from "~/modules/screening/server/domain/repositories/watch-list-repository";
import { WatchedStock } from "~/modules/screening/server/domain/value-objects/watched-stock";

/**
 * Prisma 实现的自选股列表仓储
 */
export class PrismaWatchListRepository implements IWatchListRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 保存自选股列表（创建或更新）
   * @param watchList 自选股列表
   */
  async save(watchList: WatchList): Promise<void> {
    const data = {
      name: watchList.name,
      description: watchList.description || null,
      stocks: watchList.stocks.map((stock) => stock.toDict()) as object[],
      userId: watchList.userId,
      updatedAt: watchList.updatedAt,
    };

    await this.prisma.watchList.upsert({
      where: { id: watchList.id },
      create: {
        id: watchList.id,
        createdAt: watchList.createdAt,
        ...data,
      },
      update: data,
    });
  }

  /**
   * 根据 ID 查找自选股列表
   * @param id 列表 ID
   * @returns 列表实例或 null
   */
  async findById(id: string): Promise<WatchList | null> {
    const record = await this.prisma.watchList.findUnique({
      where: { id },
    });

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  /**
   * 删除自选股列表
   * @param id 列表 ID
   */
  async delete(id: string): Promise<void> {
    await this.prisma.watchList.delete({
      where: { id },
    });
  }

  /**
   * 查找所有自选股列表
   * @returns 列表数组
   */
  async findAll(): Promise<WatchList[]> {
    const records = await this.prisma.watchList.findMany({
      orderBy: { createdAt: "desc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 根据用户查询列表（支持分页与排序）
   * @param userId 用户 ID
   * @param options 查询参数
   */
  async findByUserId(
    userId: string,
    options?: WatchListQueryOptions,
  ): Promise<WatchList[]> {
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    const sortBy = options?.sortBy ?? "createdAt";
    const sortDirection = options?.sortDirection ?? "desc";

    if (sortBy === "stockCount") {
      const records = await this.prisma.watchList.findMany({
        where: { userId },
      });

      const allWatchLists = records.map((record) => this.toDomain(record));
      allWatchLists.sort((a, b) => {
        const diff = a.stocks.length - b.stocks.length;
        return sortDirection === "asc" ? diff : -diff;
      });

      const end = limit === undefined ? undefined : offset + limit;
      return allWatchLists.slice(offset, end);
    }

    const records = await this.prisma.watchList.findMany({
      where: { userId },
      take: limit,
      skip: offset,
      orderBy:
        sortBy === "updatedAt"
          ? { updatedAt: sortDirection }
          : { createdAt: sortDirection },
    });

    return records.map((record) => this.toDomain(record));
  }

  /**
   * 根据名称查找自选股列表
   * @param name 列表名称
   * @returns 列表实例或 null
   */
  async findByName(name: string): Promise<WatchList | null> {
    const record = await this.prisma.watchList.findFirst({
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
   * @returns WatchList 实例
   */
  private toDomain(record: {
    id: string;
    name: string;
    description: string | null;
    stocks: unknown;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
  }): WatchList {
    // 反序列化 stocks
    const stocksData = record.stocks as Array<Record<string, unknown>>;
    const stocks = stocksData.map((stockData) =>
      WatchedStock.fromDict(stockData),
    );

    // 创建领域对象
    return WatchList.create({
      id: record.id,
      name: record.name,
      description: record.description ?? undefined,
      stocks,
      userId: record.userId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
