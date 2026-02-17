/**
 * PythonDataServiceClient 属性基测试
 *
 * Feature: stock-screening-platform, Property 12: HTTP 响应到领域对象映射正确性
 *
 * **Validates: Requirements 6.4**
 *
 * 测试策略：
 * - 使用 fast-check 生成随机有效的 StockData JSON 响应
 * - 验证映射后的 Stock 实体包含与原始 JSON 中所有非 null 字段对应的正确值
 * - 至少运行 100 次迭代
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PythonDataServiceClient } from "../python-data-service-client";
import { StockCode } from "~/server/domain/screening/value-objects/stock-code.js";
import { arbStockCode } from "~/server/domain/screening/__tests__/generators.js";

/**
 * 生成有效的 StockData JSON 响应
 */
const arbStockDataResponse = fc.record({
  code: arbStockCode,
  name: fc.string({ minLength: 2, maxLength: 10 }),
  industry: fc.constantFrom("白酒", "医药", "银行", "科技", "制造"),
  sector: fc.constantFrom("主板", "创业板", "科创板"),
  roe: fc.option(fc.double({ min: -0.5, max: 1.0, noNaN: true }), { nil: null }),
  pe: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: null }),
  pb: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: null }),
  eps: fc.option(fc.double({ min: -10, max: 100, noNaN: true }), { nil: null }),
  revenue: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: null }),
  netProfit: fc.option(fc.double({ min: -1000, max: 5000, noNaN: true }), { nil: null }),
  debtRatio: fc.option(fc.double({ min: 0, max: 1.0, noNaN: true }), { nil: null }),
  marketCap: fc.option(fc.double({ min: 10, max: 100000, noNaN: true }), { nil: null }),
  floatMarketCap: fc.option(fc.double({ min: 10, max: 100000, noNaN: true }), { nil: null }),
  dataDate: fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") })
    .map(d => d.toISOString().split('T')[0]!), // 格式化为 YYYY-MM-DD
});

describe("PythonDataServiceClient - Property 12: HTTP 响应映射正确性", () => {
  it("对于任意有效的 StockData JSON，映射后的 Stock 实体应包含所有非 null 字段的正确值", () => {
    fc.assert(
      fc.property(arbStockDataResponse, (stockDataJson) => {
        // 创建一个测试用的客户端实例
        const client = new PythonDataServiceClient({
          baseUrl: "http://localhost:8000",
        });

        // 通过反射访问私有方法 mapToStock
        // TypeScript 中访问私有方法需要使用类型断言
        const mapToStock = (client as unknown as { mapToStock: (data: unknown) => unknown }).mapToStock;
        const stock = mapToStock.call(client, stockDataJson);

        // 验证基础字段
        expect(stock.code).toBeInstanceOf(StockCode);
        expect(stock.code.value).toBe(stockDataJson.code);
        expect(stock.name).toBe(stockDataJson.name);
        expect(stock.industry).toBe(stockDataJson.industry);
        expect(stock.sector).toBe(stockDataJson.sector);

        // 验证数值字段：如果原始 JSON 中为 null，映射后应为 null；否则应相等
        if (stockDataJson.roe === null) {
          expect(stock.roe).toBeNull();
        } else {
          expect(stock.roe).toBe(stockDataJson.roe);
        }

        if (stockDataJson.pe === null) {
          expect(stock.pe).toBeNull();
        } else {
          expect(stock.pe).toBe(stockDataJson.pe);
        }

        if (stockDataJson.pb === null) {
          expect(stock.pb).toBeNull();
        } else {
          expect(stock.pb).toBe(stockDataJson.pb);
        }

        if (stockDataJson.eps === null) {
          expect(stock.eps).toBeNull();
        } else {
          expect(stock.eps).toBe(stockDataJson.eps);
        }

        if (stockDataJson.revenue === null) {
          expect(stock.revenue).toBeNull();
        } else {
          expect(stock.revenue).toBe(stockDataJson.revenue);
        }

        if (stockDataJson.netProfit === null) {
          expect(stock.netProfit).toBeNull();
        } else {
          expect(stock.netProfit).toBe(stockDataJson.netProfit);
        }

        if (stockDataJson.debtRatio === null) {
          expect(stock.debtRatio).toBeNull();
        } else {
          expect(stock.debtRatio).toBe(stockDataJson.debtRatio);
        }

        if (stockDataJson.marketCap === null) {
          expect(stock.marketCap).toBeNull();
        } else {
          expect(stock.marketCap).toBe(stockDataJson.marketCap);
        }

        if (stockDataJson.floatMarketCap === null) {
          expect(stock.floatMarketCap).toBeNull();
        } else {
          expect(stock.floatMarketCap).toBe(stockDataJson.floatMarketCap);
        }

        // 验证日期字段
        expect(stock.dataDate).toBeInstanceOf(Date);
        expect(stock.dataDate?.toISOString().split('T')[0]).toBe(stockDataJson.dataDate);
      }),
      { numRuns: 100 } // 至少运行 100 次迭代
    );
  });

  it("对于包含所有 null 值的 StockData JSON，映射后的 Stock 实体应正确处理所有 null 字段", () => {
    fc.assert(
      fc.property(
        arbStockCode,
        fc.string({ minLength: 2, maxLength: 10 }),
        fc.constantFrom("白酒", "医药", "银行", "科技", "制造"),
        fc.constantFrom("主板", "创业板", "科创板"),
        fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }).filter(d => !isNaN(d.getTime())),
        (code, name, industry, sector, dataDate) => {
          const stockDataJson = {
            code,
            name,
            industry,
            sector,
            roe: null,
            pe: null,
            pb: null,
            eps: null,
            revenue: null,
            netProfit: null,
            debtRatio: null,
            marketCap: null,
            floatMarketCap: null,
            dataDate: dataDate.toISOString().split('T')[0]!,
          };

          const client = new PythonDataServiceClient({
            baseUrl: "http://localhost:8000",
          });

          const mapToStock = (client as unknown as { mapToStock: (data: unknown) => unknown }).mapToStock;
          const stock = mapToStock.call(client, stockDataJson);

          // 验证所有数值字段都为 null
          expect(stock.roe).toBeNull();
          expect(stock.pe).toBeNull();
          expect(stock.pb).toBeNull();
          expect(stock.eps).toBeNull();
          expect(stock.revenue).toBeNull();
          expect(stock.netProfit).toBeNull();
          expect(stock.debtRatio).toBeNull();
          expect(stock.marketCap).toBeNull();
          expect(stock.floatMarketCap).toBeNull();

          // 验证基础字段仍然正确
          expect(stock.code.value).toBe(code);
          expect(stock.name).toBe(name);
          expect(stock.industry).toBe(industry);
          expect(stock.sector).toBe(sector);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("对于包含所有非 null 值的 StockData JSON，映射后的 Stock 实体应包含所有字段的正确值", () => {
    fc.assert(
      fc.property(
        arbStockCode,
        fc.string({ minLength: 2, maxLength: 10 }),
        fc.constantFrom("白酒", "医药", "银行", "科技", "制造"),
        fc.constantFrom("主板", "创业板", "科创板"),
        fc.double({ min: -0.5, max: 1.0, noNaN: true }),
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: -10, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 10000, noNaN: true }),
        fc.double({ min: -1000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1.0, noNaN: true }),
        fc.double({ min: 10, max: 100000, noNaN: true }),
        fc.double({ min: 10, max: 100000, noNaN: true }),
        fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        (code, name, industry, sector, roe, pe, pb, eps, revenue, netProfit, debtRatio, marketCap, floatMarketCap, dataDate) => {
          const stockDataJson = {
            code,
            name,
            industry,
            sector,
            roe,
            pe,
            pb,
            eps,
            revenue,
            netProfit,
            debtRatio,
            marketCap,
            floatMarketCap,
            dataDate: dataDate.toISOString().split('T')[0]!,
          };

          const client = new PythonDataServiceClient({
            baseUrl: "http://localhost:8000",
          });

          const mapToStock = (client as unknown as { mapToStock: (data: unknown) => unknown }).mapToStock;
          const stock = mapToStock.call(client, stockDataJson);

          // 验证所有字段都正确映射
          expect(stock.code.value).toBe(code);
          expect(stock.name).toBe(name);
          expect(stock.industry).toBe(industry);
          expect(stock.sector).toBe(sector);
          expect(stock.roe).toBe(roe);
          expect(stock.pe).toBe(pe);
          expect(stock.pb).toBe(pb);
          expect(stock.eps).toBe(eps);
          expect(stock.revenue).toBe(revenue);
          expect(stock.netProfit).toBe(netProfit);
          expect(stock.debtRatio).toBe(debtRatio);
          expect(stock.marketCap).toBe(marketCap);
          expect(stock.floatMarketCap).toBe(floatMarketCap);
          expect(stock.dataDate?.toISOString().split('T')[0]).toBe(stockDataJson.dataDate);
        }
      ),
      { numRuns: 100 }
    );
  });
});
