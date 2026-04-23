/**
 * WatchList tRPC Router
 *
 * 应用层入口，编排自选股列表的 CRUD 操作。
 * 不包含业务逻辑，仅负责：
 * - 输入验证（Zod schema）
 * - 领域服务调用编排
 * - 领域异常到 TRPCError 的映射
 *
 * Requirements: 7.4, 7.5, 7.6
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
// 领域层
import { WatchList } from "~/modules/screening/server/domain/aggregates/watch-list";
// 领域异常
import {
  DuplicateStockError,
  StockNotFoundError,
} from "~/modules/screening/server/domain/errors";
import { StockCode } from "~/modules/screening/server/domain/value-objects/stock-code";
import { normalizeTags } from "~/modules/screening/server/domain/value-objects/watched-stock";
// Repository 实现
import { PrismaWatchListRepository } from "~/modules/screening/server/infrastructure/prisma-watch-list-repository";
import { createTRPCRouter, protectedProcedure } from "~/platform/trpc/server";

/**
 * 领域异常到 TRPCError 的映射
 */
function mapDomainError(error: unknown): TRPCError {
  if (error instanceof DuplicateStockError) {
    return new TRPCError({
      code: "CONFLICT",
      message: error.message,
    });
  }

  if (error instanceof StockNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: error.message,
    });
  }

  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "未知错误",
  });
}

/**
 * Zod Schema 定义
 */

// 创建自选股列表 Schema
const createWatchListSchema = z.object({
  name: z.string().min(1, "列表名称不能为空"),
  description: z.string().optional(),
});

const listWatchListsSchema = z
  .object({
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
    sortBy: z
      .enum(["createdAt", "updatedAt", "stockCount"])
      .default("updatedAt"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
  })
  .optional();

const updateWatchListMetaSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1, "列表名称不能为空").optional(),
    description: z.string().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    "至少提供一个需要更新的字段",
  );

// 添加股票 Schema
const addStockSchema = z.object({
  watchListId: z.string(),
  stockCode: z.string().length(6, "股票代码必须为6位"),
  stockName: z.string().min(1, "股票名称不能为空"),
  note: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

// 移除股票 Schema
const removeStockSchema = z.object({
  watchListId: z.string(),
  stockCode: z.string().length(6, "股票代码必须为6位"),
});

// 更新股票备注 Schema
const updateStockNoteSchema = z.object({
  watchListId: z.string(),
  stockCode: z.string().length(6, "股票代码必须为6位"),
  note: z.string(),
});

// 更新股票标签 Schema
const updateStockTagsSchema = z.object({
  watchListId: z.string(),
  stockCode: z.string().length(6, "股票代码必须为6位"),
  tags: z.array(z.string()),
});

/**
 * WatchList Router
 */
export const watchlistRouter = createTRPCRouter({
  /**
   * 创建自选股列表
   * Requirements: 7.4, 7.5, 7.6
   */
  create: protectedProcedure
    .input(createWatchListSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 创建自选股列表聚合根
        const watchList = WatchList.create({
          name: input.name,
          description: input.description,
          userId: ctx.session.user.id,
        });

        // 持久化
        await repository.save(watchList);

        return {
          id: watchList.id,
          name: watchList.name,
          description: watchList.description,
          createdAt: watchList.createdAt,
        };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 删除自选股列表
   * Requirements: 7.4, 7.5, 7.6
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.id);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限删除此列表",
          });
        }

        // 删除列表
        await repository.delete(input.id);

        return { success: true };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 列出所有自选股列表
   * Requirements: 7.4, 7.5, 7.6
   */
  list: protectedProcedure
    .input(listWatchListsSchema)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);
        const watchLists = await repository.findByUserId(ctx.session.user.id, {
          limit: input?.limit ?? 20,
          offset: input?.offset ?? 0,
          sortBy: input?.sortBy ?? "updatedAt",
          sortDirection: input?.sortDirection ?? "desc",
        });

        return watchLists.map((watchList) => ({
          id: watchList.id,
          name: watchList.name,
          description: watchList.description,
          stockCount: watchList.stocks.length,
          createdAt: watchList.createdAt,
          updatedAt: watchList.updatedAt,
        }));
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 更新列表元信息（名称/描述）
   */
  updateMeta: protectedProcedure
    .input(updateWatchListMetaSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);
        const watchList = await repository.findById(input.id);

        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限修改此列表",
          });
        }

        if (input.name !== undefined) {
          watchList.rename(input.name);
        }
        if (input.description !== undefined) {
          watchList.updateDescription(input.description);
        }

        await repository.save(watchList);

        return {
          id: watchList.id,
          name: watchList.name,
          description: watchList.description,
          updatedAt: watchList.updatedAt,
        };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 获取自选股列表详情
   * Requirements: 7.4, 7.5, 7.6
   */
  getDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        const watchList = await repository.findById(input.id);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限查看此列表",
          });
        }

        return {
          id: watchList.id,
          name: watchList.name,
          description: watchList.description,
          stocks: watchList.stocks.map((stock) => stock.toDict()),
          createdAt: watchList.createdAt,
          updatedAt: watchList.updatedAt,
        };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 添加股票到自选股列表
   * Requirements: 7.4, 7.5, 7.6
   */
  addStock: protectedProcedure
    .input(addStockSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.watchListId);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限修改此列表",
          });
        }

        // 添加股票
        const stockCode = StockCode.create(input.stockCode);
        watchList.addStock(
          stockCode,
          input.stockName,
          input.note,
          normalizeTags(input.tags),
        );

        // 持久化
        await repository.save(watchList);

        return { success: true };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 从自选股列表移除股票
   * Requirements: 7.4, 7.5, 7.6
   */
  removeStock: protectedProcedure
    .input(removeStockSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.watchListId);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限修改此列表",
          });
        }

        // 移除股票
        const stockCode = StockCode.create(input.stockCode);
        watchList.removeStock(stockCode);

        // 持久化
        await repository.save(watchList);

        return { success: true };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 更新股票备注
   * Requirements: 7.4, 7.5, 7.6
   */
  updateStockNote: protectedProcedure
    .input(updateStockNoteSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.watchListId);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限修改此列表",
          });
        }

        // 更新备注
        const stockCode = StockCode.create(input.stockCode);
        watchList.updateStockNote(stockCode, input.note);

        // 持久化
        await repository.save(watchList);

        return { success: true };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 更新股票标签
   * Requirements: 7.4, 7.5, 7.6
   */
  updateStockTags: protectedProcedure
    .input(updateStockTagsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.watchListId);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限修改此列表",
          });
        }

        // 更新标签
        const stockCode = StockCode.create(input.stockCode);
        watchList.updateStockTags(stockCode, normalizeTags(input.tags));

        // 持久化
        await repository.save(watchList);

        return { success: true };
      } catch (error) {
        throw mapDomainError(error);
      }
    }),

  /**
   * 按标签查询股票
   * Requirements: 7.4, 7.5, 7.6
   */
  getStocksByTag: protectedProcedure
    .input(z.object({ watchListId: z.string(), tag: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWatchListRepository(ctx.db);

        // 查找列表
        const watchList = await repository.findById(input.watchListId);
        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        // 验证所有权
        if (watchList.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权限查看此列表",
          });
        }

        // 按标签查询
        const stocks = watchList.getStocksByTag(input.tag.trim().toLowerCase());

        return stocks.map((stock) => stock.toDict());
      } catch (error) {
        throw mapDomainError(error);
      }
    }),
});
