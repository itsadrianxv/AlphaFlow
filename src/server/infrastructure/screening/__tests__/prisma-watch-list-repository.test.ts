/**
 * PrismaWatchListRepository 集成测试
 *
 * 测试 Prisma 仓储实现的 CRUD 操作和序列化/反序列化逻辑。
 *
 * Requirements: 5.1
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "../../../../../generated/prisma/index";
import { PrismaWatchListRepository } from "../prisma-watch-list-repository";
import { WatchList } from "../../../domain/screening/aggregates/watch-list";
import { StockCode } from "../../../domain/screening/value-objects/stock-code";

describe("PrismaWatchListRepository", () => {
  let mockPrisma: any;
  let repository: PrismaWatchListRepository;
  const testUserId = "test-user-id";

  beforeEach(() => {
    // 创建 mock Prisma 客户端
    mockPrisma = {
      watchList: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    repository = new PrismaWatchListRepository(
      mockPrisma as unknown as PrismaClient
    );
  });

  /**
   * 创建测试用的自选股列表
   */
  function createTestWatchList(name: string): WatchList {
    const watchList = WatchList.create({
      name,
      description: "测试自选股列表",
      userId: testUserId,
    });

    // 添加一些股票
    watchList.addStock(
      StockCode.create("600519"),
      "贵州茅台",
      "白酒龙头",
      ["白酒", "消费"]
    );
    watchList.addStock(
      StockCode.create("000858"),
      "五粮液",
      "白酒第二",
      ["白酒"]
    );

    return watchList;
  }

  describe("save", () => {
    it("应该成功保存新自选股列表", async () => {
      const watchList = createTestWatchList("我的自选股");
      mockPrisma.watchList.upsert.mockResolvedValue({});

      await repository.save(watchList);

      expect(mockPrisma.watchList.upsert).toHaveBeenCalledWith({
        where: { id: watchList.id },
        create: expect.objectContaining({
          id: watchList.id,
          name: "我的自选股",
          description: "测试自选股列表",
          userId: testUserId,
        }),
        update: expect.objectContaining({
          name: "我的自选股",
          description: "测试自选股列表",
        }),
      });
    });

    it("应该正确序列化股票列表", async () => {
      const watchList = createTestWatchList("测试列表");
      mockPrisma.watchList.upsert.mockResolvedValue({});

      await repository.save(watchList);

      const call = mockPrisma.watchList.upsert.mock.calls[0][0];
      expect(Array.isArray(call.create.stocks)).toBe(true);
      expect(call.create.stocks.length).toBe(2);
      expect(call.create.stocks[0]).toHaveProperty("stockCode");
      expect(call.create.stocks[0]).toHaveProperty("stockName");
      expect(call.create.stocks[0]).toHaveProperty("addedAt");
    });

    it("应该处理空描述", async () => {
      const watchList = WatchList.create({
        name: "无描述列表",
        userId: testUserId,
      });
      mockPrisma.watchList.upsert.mockResolvedValue({});

      await repository.save(watchList);

      const call = mockPrisma.watchList.upsert.mock.calls[0][0];
      expect(call.create.description).toBeNull();
    });
  });

  describe("findById", () => {
    it("应该找到已保存的自选股列表", async () => {
      const watchList = createTestWatchList("测试列表");
      const mockRecord = {
        id: watchList.id,
        name: watchList.name,
        description: watchList.description,
        stocks: watchList.stocks.map((stock) => stock.toDict()),
        userId: watchList.userId,
        createdAt: watchList.createdAt,
        updatedAt: watchList.updatedAt,
      };
      mockPrisma.watchList.findUnique.mockResolvedValue(mockRecord);

      const found = await repository.findById(watchList.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(watchList.id);
      expect(found!.name).toBe(watchList.name);
      expect(found!.stocks.length).toBe(2);
    });

    it("应该对不存在的 ID 返回 null", async () => {
      mockPrisma.watchList.findUnique.mockResolvedValue(null);

      const found = await repository.findById("non-existent-id");

      expect(found).toBeNull();
    });

    it("应该正确反序列化股票数据", async () => {
      const watchList = createTestWatchList("测试列表");
      const mockRecord = {
        id: watchList.id,
        name: watchList.name,
        description: watchList.description,
        stocks: watchList.stocks.map((stock) => stock.toDict()),
        userId: watchList.userId,
        createdAt: watchList.createdAt,
        updatedAt: watchList.updatedAt,
      };
      mockPrisma.watchList.findUnique.mockResolvedValue(mockRecord);

      const found = await repository.findById(watchList.id);

      expect(found).not.toBeNull();
      expect(found!.stocks[0]!.stockCode.value).toBe("600519");
      expect(found!.stocks[0]!.stockName).toBe("贵州茅台");
      expect(found!.stocks[0]!.note).toBe("白酒龙头");
      expect(found!.stocks[0]!.tags).toEqual(["白酒", "消费"]);
    });
  });

  describe("delete", () => {
    it("应该成功删除自选股列表", async () => {
      const watchList = createTestWatchList("待删除列表");
      mockPrisma.watchList.delete.mockResolvedValue({});

      await repository.delete(watchList.id);

      expect(mockPrisma.watchList.delete).toHaveBeenCalledWith({
        where: { id: watchList.id },
      });
    });
  });

  describe("findAll", () => {
    it("应该返回所有自选股列表", async () => {
      const watchList1 = createTestWatchList("列表1");
      const watchList2 = createTestWatchList("列表2");

      mockPrisma.watchList.findMany.mockResolvedValue([
        {
          id: watchList1.id,
          name: watchList1.name,
          description: watchList1.description,
          stocks: watchList1.stocks.map((stock) => stock.toDict()),
          userId: watchList1.userId,
          createdAt: watchList1.createdAt,
          updatedAt: watchList1.updatedAt,
        },
        {
          id: watchList2.id,
          name: watchList2.name,
          description: watchList2.description,
          stocks: watchList2.stocks.map((stock) => stock.toDict()),
          userId: watchList2.userId,
          createdAt: watchList2.createdAt,
          updatedAt: watchList2.updatedAt,
        },
      ]);

      const all = await repository.findAll();

      expect(all.length).toBe(2);
      expect(all[0]!.name).toBe("列表1");
      expect(all[1]!.name).toBe("列表2");
    });

    it("应该按创建时间降序排列", async () => {
      mockPrisma.watchList.findMany.mockResolvedValue([]);

      await repository.findAll();

      expect(mockPrisma.watchList.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
      });
    });

    it("应该处理空列表", async () => {
      mockPrisma.watchList.findMany.mockResolvedValue([]);

      const all = await repository.findAll();

      expect(all.length).toBe(0);
    });
  });

  describe("findByName", () => {
    it("应该找到指定名称的自选股列表", async () => {
      const watchList = createTestWatchList("唯一名称列表");

      mockPrisma.watchList.findFirst.mockResolvedValue({
        id: watchList.id,
        name: watchList.name,
        description: watchList.description,
        stocks: watchList.stocks.map((stock) => stock.toDict()),
        userId: watchList.userId,
        createdAt: watchList.createdAt,
        updatedAt: watchList.updatedAt,
      });

      const found = await repository.findByName("唯一名称列表");

      expect(found).not.toBeNull();
      expect(found!.name).toBe("唯一名称列表");
      expect(mockPrisma.watchList.findFirst).toHaveBeenCalledWith({
        where: { name: "唯一名称列表" },
      });
    });

    it("应该对不存在的名称返回 null", async () => {
      mockPrisma.watchList.findFirst.mockResolvedValue(null);

      const found = await repository.findByName("不存在的列表");

      expect(found).toBeNull();
    });
  });

  describe("序列化往返一致性", () => {
    it("应该保持完整的自选股列表数据一致性", async () => {
      const watchList = WatchList.create({
        name: "完整测试列表",
        description: "包含多种股票的测试列表",
        userId: testUserId,
      });

      // 添加多个股票，包含不同的标签和备注
      watchList.addStock(
        StockCode.create("600519"),
        "贵州茅台",
        "白酒龙头，长期持有",
        ["白酒", "消费", "核心资产"]
      );
      watchList.addStock(
        StockCode.create("000858"),
        "五粮液",
        undefined,
        ["白酒"]
      );
      watchList.addStock(
        StockCode.create("600036"),
        "招商银行",
        "银行股首选",
        ["银行", "金融"]
      );

      // Mock 返回序列化后再反序列化的数据
      const mockRecord = {
        id: watchList.id,
        name: watchList.name,
        description: watchList.description,
        stocks: watchList.stocks.map((stock) => stock.toDict()),
        userId: watchList.userId,
        createdAt: watchList.createdAt,
        updatedAt: watchList.updatedAt,
      };

      mockPrisma.watchList.upsert.mockResolvedValue(mockRecord);
      mockPrisma.watchList.findUnique.mockResolvedValue(mockRecord);

      await repository.save(watchList);
      const found = await repository.findById(watchList.id);

      expect(found).not.toBeNull();

      // 验证基本信息
      expect(found!.name).toBe("完整测试列表");
      expect(found!.description).toBe("包含多种股票的测试列表");
      expect(found!.userId).toBe(testUserId);

      // 验证股票列表
      expect(found!.stocks.length).toBe(3);

      // 验证第一只股票（完整信息）
      const stock1 = found!.stocks.find(
        (s) => s.stockCode.value === "600519"
      );
      expect(stock1).toBeDefined();
      expect(stock1!.stockName).toBe("贵州茅台");
      expect(stock1!.note).toBe("白酒龙头，长期持有");
      expect(stock1!.tags).toEqual(["白酒", "消费", "核心资产"]);

      // 验证第二只股票（无备注）
      const stock2 = found!.stocks.find(
        (s) => s.stockCode.value === "000858"
      );
      expect(stock2).toBeDefined();
      expect(stock2!.stockName).toBe("五粮液");
      expect(stock2!.note).toBeUndefined();
      expect(stock2!.tags).toEqual(["白酒"]);

      // 验证第三只股票
      const stock3 = found!.stocks.find(
        (s) => s.stockCode.value === "600036"
      );
      expect(stock3).toBeDefined();
      expect(stock3!.stockName).toBe("招商银行");
      expect(stock3!.note).toBe("银行股首选");
      expect(stock3!.tags).toEqual(["银行", "金融"]);
    });

    it("应该正确处理空股票列表", async () => {
      const watchList = WatchList.create({
        name: "空列表",
        description: "没有股票的列表",
        userId: testUserId,
      });

      const mockRecord = {
        id: watchList.id,
        name: watchList.name,
        description: watchList.description,
        stocks: [],
        userId: watchList.userId,
        createdAt: watchList.createdAt,
        updatedAt: watchList.updatedAt,
      };

      mockPrisma.watchList.upsert.mockResolvedValue(mockRecord);
      mockPrisma.watchList.findUnique.mockResolvedValue(mockRecord);

      await repository.save(watchList);
      const found = await repository.findById(watchList.id);

      expect(found).not.toBeNull();
      expect(found!.stocks.length).toBe(0);
    });
  });
});
