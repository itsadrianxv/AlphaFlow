/**
 * ScreeningSession 聚合根属性基测试
 *
 * Feature: stock-screening-platform
 * Property 9: ScreeningSession 分层存储不变量
 *
 * 对于任意 ScreeningResult 生成的 ScreeningSession，topStocks 的长度应不超过 50，
 * 且 `topStocks.length + otherStockCodes.length` 应等于筛选匹配的总股票数。
 *
 * **Validates: Requirements 3.6**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ScreeningSession } from "../screening-session";
import { ScreeningResult } from "../../value-objects/screening-result";
import { ScoredStock } from "../../value-objects/scored-stock";
import { StockCode } from "../../value-objects/stock-code";
import { FilterGroup } from "../../entities/filter-group";
import { FilterCondition } from "../../value-objects/filter-condition";
import { ScoringConfig, NormalizationMethod } from "../../value-objects/scoring-config";
import { IndicatorField } from "../../enums/indicator-field";
import { ComparisonOperator } from "../../enums/comparison-operator";
import { LogicalOperator } from "../../enums/logical-operator";

// ==================== 生成器定义 ====================

/**
 * 生成有效的股票代码（6位数字，以0/3/6开头）
 */
const arbStockCode = fc
  .tuple(
    fc.constantFrom("0", "3", "6"),
    fc.integer({ min: 0, max: 99999 })
  )
  .map(([prefix, num]) => `${prefix}${num.toString().padStart(5, "0")}`);

/**
 * 生成股票名称
 */
const arbStockName = fc.string({ minLength: 2, maxLength: 10 });

/**
 * 生成评分（0-1 区间）
 */
const arbScore = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/**
 * 生成 ScoredStock
 */
const arbScoredStock = fc
  .tuple(arbStockCode, arbStockName, arbScore)
  .map(([code, name, score]) => {
    return ScoredStock.create(
      StockCode.create(code),
      name,
      score,
      new Map([[IndicatorField.ROE, score]]),
      new Map([[IndicatorField.ROE, score * 0.3]]),
      []
    );
  });

/**
 * 生成按评分降序排列的 ScoredStock 数组（确保股票代码唯一）
 * @param minLength 最小长度
 * @param maxLength 最大长度
 */
const arbSortedScoredStocks = (minLength: number, maxLength: number) =>
  fc
    .array(arbScoredStock, { minLength, maxLength })
    .map((stocks) => {
      // 去重：确保每个股票代码只出现一次
      const uniqueStocks: ScoredStock[] = [];
      const seenCodes = new Set<string>();
      
      for (const stock of stocks) {
        const codeValue = stock.stockCode.value;
        if (!seenCodes.has(codeValue)) {
          seenCodes.add(codeValue);
          uniqueStocks.push(stock);
        }
      }
      
      // 按评分降序排序
      return uniqueStocks.sort((a, b) => b.score - a.score);
    })
    .filter((stocks) => stocks.length >= minLength); // 确保去重后仍满足最小长度要求

/**
 * 生成 ScreeningResult
 * @param minMatched 最小匹配数
 * @param maxMatched 最大匹配数
 */
const arbScreeningResult = (minMatched: number, maxMatched: number) =>
  fc
    .tuple(
      arbSortedScoredStocks(minMatched, maxMatched),
      fc.integer({ min: maxMatched, max: 10000 }),
      fc.double({ min: 0, max: 10000, noNaN: true })
    )
    .map(([matchedStocks, totalScanned, executionTime]) => {
      return ScreeningResult.create(matchedStocks, totalScanned, executionTime);
    });

/**
 * 生成测试用的 FilterGroup
 */
const arbTestFilterGroup = fc.constant(
  FilterGroup.create(
    LogicalOperator.AND,
    [
      FilterCondition.create(
        IndicatorField.ROE,
        ComparisonOperator.GREATER_THAN,
        { type: "numeric", value: 0.15 }
      ),
    ],
    []
  )
);

/**
 * 生成测试用的 ScoringConfig
 */
const arbTestScoringConfig = fc.constant(
  ScoringConfig.create(
    new Map([[IndicatorField.ROE, 1.0]]),
    NormalizationMethod.MIN_MAX
  )
);

// ==================== 属性基测试 ====================

describe("ScreeningSession - Property-Based Tests", () => {
  describe("Property 9: ScreeningSession 分层存储不变量", () => {
    it("对于少于 50 只股票的结果，应该全部保存在 topStocks 中", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(0, 49),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const matchedCount = result.matchedStocks.length;

            // 不变量 (a): topStocks 长度不超过 50
            expect(session.topStocks.length).toBeLessThanOrEqual(50);

            // 不变量 (b): topStocks + otherStockCodes 总数等于匹配总数
            expect(session.topStocks.length + session.otherStockCodes.length).toBe(
              matchedCount
            );

            // 对于少于 50 只的情况，所有股票都应该在 topStocks 中
            expect(session.topStocks.length).toBe(matchedCount);
            expect(session.otherStockCodes.length).toBe(0);

            // countMatched 应该返回正确的总数
            expect(session.countMatched()).toBe(matchedCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("对于恰好 50 只股票的结果，应该全部保存在 topStocks 中", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(50, 50),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            // 不变量 (a): topStocks 长度不超过 50
            expect(session.topStocks.length).toBe(50);

            // 不变量 (b): topStocks + otherStockCodes 总数等于匹配总数
            expect(session.topStocks.length + session.otherStockCodes.length).toBe(50);

            // 恰好 50 只，otherStockCodes 应该为空
            expect(session.otherStockCodes.length).toBe(0);

            // countMatched 应该返回 50
            expect(session.countMatched()).toBe(50);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("对于超过 50 只股票的结果，应该分层存储", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(51, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const matchedCount = result.matchedStocks.length;

            // 不变量 (a): topStocks 长度不超过 50
            expect(session.topStocks.length).toBe(50);

            // 不变量 (b): topStocks + otherStockCodes 总数等于匹配总数
            expect(session.topStocks.length + session.otherStockCodes.length).toBe(
              matchedCount
            );

            // 超过 50 只，otherStockCodes 应该包含剩余的股票代码
            expect(session.otherStockCodes.length).toBe(matchedCount - 50);

            // countMatched 应该返回正确的总数
            expect(session.countMatched()).toBe(matchedCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("topStocks 应该包含评分最高的前 N 只股票", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(51, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const originalTopStocks = result.matchedStocks.slice(0, 50);

            // topStocks 应该与原始结果的前 50 只股票一致
            expect(session.topStocks.length).toBe(50);

            for (let i = 0; i < 50; i++) {
              expect(session.topStocks[i]!.stockCode.equals(originalTopStocks[i]!.stockCode)).toBe(
                true
              );
              expect(session.topStocks[i]!.score).toBe(originalTopStocks[i]!.score);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("otherStockCodes 应该包含剩余股票的代码", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(51, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const originalOtherStocks = result.matchedStocks.slice(50);

            // otherStockCodes 应该与原始结果的剩余股票代码一致
            expect(session.otherStockCodes.length).toBe(originalOtherStocks.length);

            for (let i = 0; i < originalOtherStocks.length; i++) {
              expect(
                session.otherStockCodes[i]!.equals(originalOtherStocks[i]!.stockCode)
              ).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("getAllMatchedCodes 应该返回所有匹配股票的代码", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(0, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const allCodes = session.getAllMatchedCodes();
            const matchedCount = result.matchedStocks.length;

            // getAllMatchedCodes 应该返回所有匹配股票的代码
            expect(allCodes.length).toBe(matchedCount);

            // 验证代码顺序与原始结果一致
            for (let i = 0; i < matchedCount; i++) {
              expect(allCodes[i]!.equals(result.matchedStocks[i]!.stockCode)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("getStockDetail 应该只对前 50 只股票返回详细信息", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(51, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            // 前 50 只股票应该有详细信息
            for (let i = 0; i < 50; i++) {
              const code = result.matchedStocks[i]!.stockCode;
              const detail = session.getStockDetail(code);
              expect(detail).not.toBeNull();
              expect(detail!.stockCode.equals(code)).toBe(true);
            }

            // 超过 50 只的股票应该返回 null
            for (let i = 50; i < result.matchedStocks.length; i++) {
              const code = result.matchedStocks[i]!.stockCode;
              const detail = session.getStockDetail(code);
              expect(detail).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("序列化往返应该保持分层存储不变量", () => {
      fc.assert(
        fc.property(
          arbScreeningResult(0, 200),
          arbTestFilterGroup,
          arbTestScoringConfig,
          (result, filters, scoringConfig) => {
            const session = ScreeningSession.create({
              strategyId: "test-strategy",
              strategyName: "测试策略",
              userId: "test-user-1",
              result,
              filtersSnapshot: filters,
              scoringConfigSnapshot: scoringConfig,
            });

            const dict = session.toDict();
            const restored = ScreeningSession.fromDict(dict);

            // 验证分层存储不变量在序列化往返后仍然成立
            expect(restored.topStocks.length).toBeLessThanOrEqual(50);
            expect(restored.topStocks.length + restored.otherStockCodes.length).toBe(
              session.countMatched()
            );

            // 验证数据一致性
            expect(restored.topStocks.length).toBe(session.topStocks.length);
            expect(restored.otherStockCodes.length).toBe(session.otherStockCodes.length);
            expect(restored.countMatched()).toBe(session.countMatched());
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
