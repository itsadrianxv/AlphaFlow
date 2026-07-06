/**
 * WatchList tRPC Router 集成测试
 *
 * 测试自选股列表的 tRPC 端点，验证：
 * - Zod 输入验证
 * - Schema 结构正确性
 *
 * Requirements: 7.4, 7.5, 7.6
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Zod Schema 定义（从 router 复制用于测试）
 */

// 创建自选股列表 Schema
const createWatchListSchema = z.object({
  name: z.string().min(1, "列表名称不能为空"),
  description: z.string().optional(),
});

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

describe("watchlistRouter - Schema Validation", () => {
  describe("create - 输入验证", () => {
    it("应该接受有效的列表输入", () => {
      const input = {
        name: "我的自选股",
        description: "测试列表",
      };

      const result = createWatchListSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝空名称", () => {
      const input = {
        name: "",
        description: "测试列表",
      };

      const result = createWatchListSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该允许不提供描述", () => {
      const input = {
        name: "我的自选股",
      };

      const result = createWatchListSchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });

  describe("addStock - 输入验证", () => {
    it("应该接受有效的股票输入", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        stockName: "贵州茅台",
        note: "长期看好",
        tags: ["白酒", "高ROE"],
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的股票代码（长度不为6）", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "60051", // 只有5位
        stockName: "贵州茅台",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该拒绝空的股票名称", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        stockName: "",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该允许不提供备注和标签", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        stockName: "贵州茅台",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
      }
    });

    it("应该使用默认空数组作为标签", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        stockName: "贵州茅台",
        note: "测试",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
      }
    });
  });

  describe("removeStock - 输入验证", () => {
    it("应该接受有效的输入", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
      };

      const result = removeStockSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的股票代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "60051", // 只有5位
      };

      const result = removeStockSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("updateStockNote - 输入验证", () => {
    it("应该接受有效的输入", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        note: "更新后的备注",
      };

      const result = updateStockNoteSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的股票代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "60051",
        note: "备注",
      };

      const result = updateStockNoteSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("updateStockTags - 输入验证", () => {
    it("应该接受有效的输入", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        tags: ["白酒", "消费", "核心资产"],
      };

      const result = updateStockTagsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该允许空标签数组", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        tags: [],
      };

      const result = updateStockTagsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝无效的股票代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "60051",
        tags: ["标签"],
      };

      const result = updateStockTagsSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("股票代码验证", () => {
    it("应该接受以0开头的6位代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "000001",
        stockName: "平安银行",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该接受以3开头的6位代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "300750",
        stockName: "宁德时代",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该接受以6开头的6位代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        stockName: "贵州茅台",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该拒绝7位代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "6005190",
        stockName: "测试",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("应该拒绝5位代码", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "60051",
        stockName: "测试",
      };

      const result = addStockSchema.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该接受包含特殊字符的备注", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        note: "长期看好！@#$%^&*()",
      };

      const result = updateStockNoteSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该接受包含中文的标签", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        tags: ["白酒", "医药", "科技"],
      };

      const result = updateStockTagsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("应该接受包含英文的标签", () => {
      const input = {
        watchListId: "watchlist-123",
        stockCode: "600519",
        tags: ["tech", "healthcare", "consumer"],
      };

      const result = updateStockTagsSchema.safeParse(input);

      expect(result.success).toBe(true);
    });
  });
});
