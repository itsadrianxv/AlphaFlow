/**
 * WatchList 聚合根属性基测试
 *
 * Feature: stock-screening-platform
 * Property 10: WatchList 添加/移除/包含一致性
 * Property 11: WatchList 标签过滤正确性
 *
 * **Validates: Requirements 5.2, 5.3, 5.4, 5.5**
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { WatchList } from "../watch-list";
import { StockCode } from "../../value-objects/stock-code";
import { DuplicateStockError } from "../../errors";
import { arbStockCode } from "../../__tests__/generators";

/**
 * 定义操作类型
 */
type WatchListOperation =
  | { type: "add"; code: string; name: string }
  | { type: "remove"; code: string };

/**
 * 生成随机操作序列
 */
const arbOperationSequence = fc.array(
  fc.oneof(
    fc.record({
      type: fc.constant("add" as const),
      code: arbStockCode,
      name: fc.string({ minLength: 2, maxLength: 10 }),
    }),
    fc.record({
      type: fc.constant("remove" as const),
      code: arbStockCode,
    })
  ),
  { minLength: 1, maxLength: 20 }
);

describe("WatchList Property-Based Tests", () => {
  describe("Property 10: WatchList 添加/移除/包含一致性", () => {
    it("添加后 contains 应返回 true", () => {
      fc.assert(
        fc.property(arbStockCode, fc.string({ minLength: 2, maxLength: 10 }), (code, name) => {
          const watchList = WatchList.create({
            name: "测试列表",
            userId: "user-1",
          });

          const stockCode = StockCode.create(code);
          watchList.addStock(stockCode, name);

          // 验证：添加后 contains 返回 true
          return watchList.contains(stockCode);
        }),
        { numRuns: 100 }
      );
    });

    it("移除后 contains 应返回 false", () => {
      fc.assert(
        fc.property(arbStockCode, fc.string({ minLength: 2, maxLength: 10 }), (code, name) => {
          const watchList = WatchList.create({
            name: "测试列表",
            userId: "user-1",
          });

          const stockCode = StockCode.create(code);
          watchList.addStock(stockCode, name);
          watchList.removeStock(stockCode);

          // 验证：移除后 contains 返回 false
          return !watchList.contains(stockCode);
        }),
        { numRuns: 100 }
      );
    });

    it("重复添加相同股票应抛出 DuplicateStockError", () => {
      fc.assert(
        fc.property(arbStockCode, fc.string({ minLength: 2, maxLength: 10 }), (code, name) => {
          const watchList = WatchList.create({
            name: "测试列表",
            userId: "user-1",
          });

          const stockCode = StockCode.create(code);
          watchList.addStock(stockCode, name);

          // 验证：重复添加抛出 DuplicateStockError
          try {
            watchList.addStock(stockCode, name);
            return false; // 如果没有抛出异常，测试失败
          } catch (error) {
            return error instanceof DuplicateStockError;
          }
        }),
        { numRuns: 100 }
      );
    });

    it("随机操作序列应保持一致性", () => {
      fc.assert(
        fc.property(arbOperationSequence, (operations) => {
          const watchList = WatchList.create({
            name: "测试列表",
            userId: "user-1",
          });

          // 跟踪预期状态
          const expectedStocks = new Set<string>();

          for (const op of operations) {
            const stockCode = StockCode.create(op.code);

            if (op.type === "add") {
              const isAlreadyPresent = expectedStocks.has(op.code);

              if (isAlreadyPresent) {
                // 如果已存在，添加应抛出异常
                try {
                  watchList.addStock(stockCode, op.name);
                  return false; // 应该抛出异常但没有
                } catch (error) {
                  if (!(error instanceof DuplicateStockError)) {
                    return false; // 抛出了错误的异常类型
                  }
                }
              } else {
                // 如果不存在，添加应成功
                watchList.addStock(stockCode, op.name);
                expectedStocks.add(op.code);

                // 验证添加后 contains 返回 true
                if (!watchList.contains(stockCode)) {
                  return false;
                }
              }
            } else if (op.type === "remove") {
              const isPresent = expectedStocks.has(op.code);

              if (isPresent) {
                // 如果存在，移除应成功
                watchList.removeStock(stockCode);
                expectedStocks.delete(op.code);

                // 验证移除后 contains 返回 false
                if (watchList.contains(stockCode)) {
                  return false;
                }
              } else {
                // 如果不存在，移除应抛出异常（但我们跳过这个操作以简化测试）
                // 这里我们不执行移除操作，因为会抛出 StockNotFoundError
                continue;
              }
            }
          }

          // 最终验证：WatchList 的状态应与预期一致
          for (const code of expectedStocks) {
            if (!watchList.contains(StockCode.create(code))) {
              return false;
            }
          }

          // 验证 stocks 数量与预期一致
          return watchList.stocks.length === expectedStocks.size;
        }),
        { numRuns: 100 }
      );
    });

    it("添加-移除-再添加序列应保持一致性", () => {
      fc.assert(
        fc.property(arbStockCode, fc.string({ minLength: 2, maxLength: 10 }), (code, name) => {
          const watchList = WatchList.create({
            name: "测试列表",
            userId: "user-1",
          });

          const stockCode = StockCode.create(code);

          // 第一次添加
          watchList.addStock(stockCode, name);
          if (!watchList.contains(stockCode)) {
            return false;
          }

          // 移除
          watchList.removeStock(stockCode);
          if (watchList.contains(stockCode)) {
            return false;
          }

          // 再次添加（应该成功，因为已经移除了）
          watchList.addStock(stockCode, name);
          return watchList.contains(stockCode);
        }),
        { numRuns: 100 }
      );
    });

    it("多个不同股票的添加和移除应独立", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(arbStockCode, fc.string({ minLength: 2, maxLength: 10 })),
            { minLength: 2, maxLength: 10 }
          ),
          (stockPairs) => {
            // 去重：确保所有股票代码不同
            const uniqueStocks = Array.from(
              new Map(stockPairs.map(([code, name]) => [code, name])).entries()
            );

            if (uniqueStocks.length < 2) {
              return true; // 跳过重复的情况
            }

            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 添加所有股票
            for (const [code, name] of uniqueStocks) {
              watchList.addStock(StockCode.create(code), name);
            }

            // 验证所有股票都存在
            for (const [code] of uniqueStocks) {
              if (!watchList.contains(StockCode.create(code))) {
                return false;
              }
            }

            // 移除第一个股票
            const [firstCode] = uniqueStocks[0]!;
            watchList.removeStock(StockCode.create(firstCode));

            // 验证第一个股票不存在
            if (watchList.contains(StockCode.create(firstCode))) {
              return false;
            }

            // 验证其他股票仍然存在
            for (let i = 1; i < uniqueStocks.length; i++) {
              const [code] = uniqueStocks[i]!;
              if (!watchList.contains(StockCode.create(code))) {
                return false;
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 11: WatchList 标签过滤正确性", () => {
    /**
     * 生成随机标签列表
     */
    const arbTags = fc.array(
      fc.string({ minLength: 1, maxLength: 10 }),
      { minLength: 0, maxLength: 5 }
    );

    /**
     * 生成带标签的股票数据
     */
    const arbStockWithTags = fc.record({
      code: arbStockCode,
      name: fc.string({ minLength: 2, maxLength: 10 }),
      tags: arbTags,
    });

    it("getStocksByTag 返回的所有股票都应包含该标签", () => {
      fc.assert(
        fc.property(
          fc.array(arbStockWithTags, { minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (stocks, queryTag) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 去重：确保所有股票代码不同
            const uniqueStocks = Array.from(
              new Map(stocks.map((s) => [s.code, s])).values()
            );

            // 添加所有股票
            for (const stock of uniqueStocks) {
              watchList.addStock(
                StockCode.create(stock.code),
                stock.name,
                undefined,
                stock.tags
              );
            }

            // 查询包含指定标签的股票
            const result = watchList.getStocksByTag(queryTag);

            // 验证：返回的所有股票都应包含该标签
            return result.every((watchedStock) =>
              watchedStock.hasTag(queryTag)
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it("WatchList 中所有包含该标签的股票都应出现在返回结果中", () => {
      fc.assert(
        fc.property(
          fc.array(arbStockWithTags, { minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (stocks, queryTag) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 去重：确保所有股票代码不同
            const uniqueStocks = Array.from(
              new Map(stocks.map((s) => [s.code, s])).values()
            );

            // 添加所有股票
            for (const stock of uniqueStocks) {
              watchList.addStock(
                StockCode.create(stock.code),
                stock.name,
                undefined,
                stock.tags
              );
            }

            // 查询包含指定标签的股票
            const result = watchList.getStocksByTag(queryTag);

            // 计算预期包含该标签的股票数量
            const expectedStocksWithTag = uniqueStocks.filter((s) =>
              s.tags.includes(queryTag)
            );

            // 验证：返回结果的数量应等于预期数量
            if (result.length !== expectedStocksWithTag.length) {
              return false;
            }

            // 验证：所有预期的股票都应出现在结果中
            for (const expectedStock of expectedStocksWithTag) {
              const found = result.some(
                (watchedStock) =>
                  watchedStock.stockCode.value === expectedStock.code
              );
              if (!found) {
                return false;
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("查询不存在的标签应返回空数组", () => {
      fc.assert(
        fc.property(
          fc.array(arbStockWithTags, { minLength: 1, maxLength: 20 }),
          (stocks) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 去重：确保所有股票代码不同
            const uniqueStocks = Array.from(
              new Map(stocks.map((s) => [s.code, s])).values()
            );

            // 添加所有股票
            for (const stock of uniqueStocks) {
              watchList.addStock(
                StockCode.create(stock.code),
                stock.name,
                undefined,
                stock.tags
              );
            }

            // 收集所有已使用的标签
            const usedTags = new Set(
              uniqueStocks.flatMap((s) => s.tags)
            );

            // 生成一个不存在的标签（使用UUID确保唯一性）
            const nonExistentTag = `non-existent-tag-${Math.random().toString(36).substring(7)}`;

            // 如果碰巧生成的标签已存在，跳过此测试
            if (usedTags.has(nonExistentTag)) {
              return true;
            }

            // 查询不存在的标签
            const result = watchList.getStocksByTag(nonExistentTag);

            // 验证：应返回空数组
            return result.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("标签过滤应支持多个股票共享同一标签", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.array(arbStockCode, { minLength: 2, maxLength: 10 }),
          (sharedTag, codes) => {
            // 去重
            const uniqueCodes = Array.from(new Set(codes));
            if (uniqueCodes.length < 2) {
              return true; // 跳过重复的情况
            }

            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 添加所有股票，都带有相同的标签
            for (const code of uniqueCodes) {
              watchList.addStock(
                StockCode.create(code),
                `股票-${code}`,
                undefined,
                [sharedTag]
              );
            }

            // 查询共享标签
            const result = watchList.getStocksByTag(sharedTag);

            // 验证：返回的股票数量应等于添加的股票数量
            return result.length === uniqueCodes.length;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("标签过滤应支持股票有多个标签", () => {
      fc.assert(
        fc.property(
          fc.array(arbStockWithTags, { minLength: 1, maxLength: 20 }),
          (stocks) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 去重：确保所有股票代码不同
            const uniqueStocks = Array.from(
              new Map(stocks.map((s) => [s.code, s])).values()
            );

            // 添加所有股票
            for (const stock of uniqueStocks) {
              watchList.addStock(
                StockCode.create(stock.code),
                stock.name,
                undefined,
                stock.tags
              );
            }

            // 收集所有标签
            const allTags = new Set(
              uniqueStocks.flatMap((s) => s.tags)
            );

            // 对每个标签进行查询验证
            for (const tag of allTags) {
              const result = watchList.getStocksByTag(tag);

              // 计算预期包含该标签的股票
              const expectedStocks = uniqueStocks.filter((s) =>
                s.tags.includes(tag)
              );

              // 验证：返回结果的数量应等于预期数量
              if (result.length !== expectedStocks.length) {
                return false;
              }

              // 验证：所有返回的股票都应包含该标签
              for (const watchedStock of result) {
                if (!watchedStock.hasTag(tag)) {
                  return false;
                }
              }
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("空 WatchList 查询任意标签应返回空数组", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10 }),
          (tag) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            // 查询标签
            const result = watchList.getStocksByTag(tag);

            // 验证：应返回空数组
            return result.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("标签过滤应区分大小写", () => {
      fc.assert(
        fc.property(
          arbStockCode,
          fc.string({ minLength: 2, maxLength: 10 }).filter(s => s.toLowerCase() !== s.toUpperCase()),
          (code, tag) => {
            const watchList = WatchList.create({
              name: "测试列表",
              userId: "user-1",
            });

            const lowerTag = tag.toLowerCase();
            const upperTag = tag.toUpperCase();

            // 如果大小写相同，跳过此测试
            if (lowerTag === upperTag) {
              return true;
            }

            // 添加股票，使用小写标签
            watchList.addStock(
              StockCode.create(code),
              "测试股票",
              undefined,
              [lowerTag]
            );

            // 查询大写标签
            const resultUpper = watchList.getStocksByTag(upperTag);

            // 查询小写标签
            const resultLower = watchList.getStocksByTag(lowerTag);

            // 验证：大写标签应返回空数组，小写标签应返回1个股票
            return resultUpper.length === 0 && resultLower.length === 1;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
