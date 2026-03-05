/**
 * WatchList 聚合根单元测试
 *
 * 测试 WatchList 的核心行为和业务规则
 */

import { describe, it, expect } from "vitest";
import { WatchList } from "../watch-list";
import { StockCode } from "../../value-objects/stock-code";
import { WatchedStock } from "../../value-objects/watched-stock";
import { DuplicateStockError, StockNotFoundError } from "../../errors";

describe("WatchList", () => {
  describe("create", () => {
    it("应该创建空的自选股列表", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      expect(watchList.name).toBe("我的自选股");
      expect(watchList.userId).toBe("user-1");
      expect(watchList.stocks).toHaveLength(0);
      expect(watchList.description).toBe("");
    });

    it("应该创建带描述的自选股列表", () => {
      const watchList = WatchList.create({
        name: "高ROE股票",
        description: "ROE > 20% 的优质股票",
        userId: "user-1",
      });

      expect(watchList.description).toBe("ROE > 20% 的优质股票");
    });

    it("应该创建带初始股票的自选股列表", () => {
      const stock1 = WatchedStock.create(
        StockCode.create("600519"),
        "贵州茅台",
        new Date()
      );
      const stock2 = WatchedStock.create(
        StockCode.create("000001"),
        "平安银行",
        new Date()
      );

      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
        stocks: [stock1, stock2],
      });

      expect(watchList.stocks).toHaveLength(2);
      expect(watchList.contains(StockCode.create("600519"))).toBe(true);
      expect(watchList.contains(StockCode.create("000001"))).toBe(true);
    });
  });

  describe("addStock", () => {
    it("应该成功添加股票", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台");

      expect(watchList.stocks).toHaveLength(1);
      expect(watchList.contains(code)).toBe(true);
    });

    it("应该添加带备注和标签的股票", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台", "长期看好", ["白酒", "高ROE"]);

      const stocks = watchList.stocks;
      expect(stocks).toHaveLength(1);
      expect(stocks[0]!.note).toBe("长期看好");
      expect(stocks[0]!.tags).toEqual(["白酒", "高ROE"]);
    });

    it("应该在添加重复股票时抛出 DuplicateStockError", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台");

      expect(() => {
        watchList.addStock(code, "贵州茅台");
      }).toThrow(DuplicateStockError);
    });
  });

  describe("removeStock", () => {
    it("应该成功移除股票", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台");
      expect(watchList.contains(code)).toBe(true);

      watchList.removeStock(code);
      expect(watchList.contains(code)).toBe(false);
      expect(watchList.stocks).toHaveLength(0);
    });

    it("应该在移除不存在的股票时抛出 StockNotFoundError", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");

      expect(() => {
        watchList.removeStock(code);
      }).toThrow(StockNotFoundError);
    });
  });

  describe("updateStockNote", () => {
    it("应该成功更新股票备注", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台", "初始备注");

      watchList.updateStockNote(code, "更新后的备注");

      const stocks = watchList.stocks;
      expect(stocks[0]!.note).toBe("更新后的备注");
    });

    it("应该在更新不存在的股票备注时抛出 StockNotFoundError", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");

      expect(() => {
        watchList.updateStockNote(code, "新备注");
      }).toThrow(StockNotFoundError);
    });
  });

  describe("updateStockTags", () => {
    it("应该成功更新股票标签", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台", undefined, ["白酒"]);

      watchList.updateStockTags(code, ["白酒", "高ROE", "消费"]);

      const stocks = watchList.stocks;
      expect(stocks[0]!.tags).toEqual(["白酒", "高ROE", "消费"]);
    });

    it("应该在更新不存在的股票标签时抛出 StockNotFoundError", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");

      expect(() => {
        watchList.updateStockTags(code, ["新标签"]);
      }).toThrow(StockNotFoundError);
    });
  });

  describe("contains", () => {
    it("应该在包含股票时返回 true", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");
      watchList.addStock(code, "贵州茅台");

      expect(watchList.contains(code)).toBe(true);
    });

    it("应该在不包含股票时返回 false", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const code = StockCode.create("600519");

      expect(watchList.contains(code)).toBe(false);
    });
  });

  describe("getStocksByTag", () => {
    it("应该返回包含指定标签的所有股票", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      watchList.addStock(
        StockCode.create("600519"),
        "贵州茅台",
        undefined,
        ["白酒", "高ROE"]
      );
      watchList.addStock(
        StockCode.create("000858"),
        "五粮液",
        undefined,
        ["白酒"]
      );
      watchList.addStock(
        StockCode.create("000001"),
        "平安银行",
        undefined,
        ["金融", "高ROE"]
      );

      const whiteWineStocks = watchList.getStocksByTag("白酒");
      expect(whiteWineStocks).toHaveLength(2);
      expect(
        whiteWineStocks.some((s) => s.stockCode.value === "600519")
      ).toBe(true);
      expect(
        whiteWineStocks.some((s) => s.stockCode.value === "000858")
      ).toBe(true);

      const highROEStocks = watchList.getStocksByTag("高ROE");
      expect(highROEStocks).toHaveLength(2);
      expect(
        highROEStocks.some((s) => s.stockCode.value === "600519")
      ).toBe(true);
      expect(
        highROEStocks.some((s) => s.stockCode.value === "000001")
      ).toBe(true);
    });

    it("应该在没有匹配标签时返回空数组", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      watchList.addStock(
        StockCode.create("600519"),
        "贵州茅台",
        undefined,
        ["白酒"]
      );

      const result = watchList.getStocksByTag("科技");
      expect(result).toHaveLength(0);
    });

    it("应该在空列表中返回空数组", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      const result = watchList.getStocksByTag("白酒");
      expect(result).toHaveLength(0);
    });
  });

  describe("toDict / fromDict", () => {
    it("应该正确序列化和反序列化", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        description: "测试列表",
        userId: "user-1",
      });

      watchList.addStock(
        StockCode.create("600519"),
        "贵州茅台",
        "长期看好",
        ["白酒", "高ROE"]
      );
      watchList.addStock(
        StockCode.create("000001"),
        "平安银行",
        undefined,
        ["金融"]
      );

      const dict = watchList.toDict();
      const restored = WatchList.fromDict(dict);

      expect(restored.id).toBe(watchList.id);
      expect(restored.name).toBe(watchList.name);
      expect(restored.description).toBe(watchList.description);
      expect(restored.userId).toBe(watchList.userId);
      expect(restored.stocks).toHaveLength(2);
      expect(restored.contains(StockCode.create("600519"))).toBe(true);
      expect(restored.contains(StockCode.create("000001"))).toBe(true);
    });
  });

  describe("equals", () => {
    it("应该在 ID 相同时返回 true", () => {
      const watchList1 = WatchList.create({
        name: "列表1",
        userId: "user-1",
        id: "same-id",
      });

      const watchList2 = WatchList.create({
        name: "列表2",
        userId: "user-2",
        id: "same-id",
      });

      expect(watchList1.equals(watchList2)).toBe(true);
    });

    it("应该在 ID 不同时返回 false", () => {
      const watchList1 = WatchList.create({
        name: "列表1",
        userId: "user-1",
      });

      const watchList2 = WatchList.create({
        name: "列表2",
        userId: "user-1",
      });

      expect(watchList1.equals(watchList2)).toBe(false);
    });

    it("应该在比较 null 或 undefined 时返回 false", () => {
      const watchList = WatchList.create({
        name: "列表1",
        userId: "user-1",
      });

      expect(watchList.equals(null)).toBe(false);
      expect(watchList.equals(undefined)).toBe(false);
    });
  });

  describe("toString", () => {
    it("应该返回正确的字符串表示", () => {
      const watchList = WatchList.create({
        name: "我的自选股",
        userId: "user-1",
      });

      watchList.addStock(StockCode.create("600519"), "贵州茅台");
      watchList.addStock(StockCode.create("000001"), "平安银行");

      const str = watchList.toString();
      expect(str).toContain("WatchList");
      expect(str).toContain("我的自选股");
      expect(str).toContain("2 stocks");
    });
  });
});
