/**
 * PythonDataServiceClient 单元测试
 *
 * 测试 HTTP 客户端的核心功能：
 * - HTTP 请求和响应处理
 * - JSON 到领域对象的映射
 * - 错误处理和超时
 * - DataNotAvailableError 转换
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PythonDataServiceClient } from "../python-data-service-client";
import { StockCode } from "~/server/domain/screening/value-objects/stock-code.js";
import { DataNotAvailableError } from "~/server/domain/screening/errors.js";
import { IndicatorField } from "~/server/domain/screening/enums/indicator-field.js";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("PythonDataServiceClient", () => {
  let client: PythonDataServiceClient;
  const baseUrl = "http://localhost:8000";

  beforeEach(() => {
    client = new PythonDataServiceClient({
      baseUrl,
      timeout: 5000,
    });
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getAllStockCodes", () => {
    it("应该成功获取股票代码列表", async () => {
      const mockResponse = {
        codes: ["600519", "000001", "000002"],
        total: 3,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getAllStockCodes();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/stocks/codes`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );

      expect(result).toHaveLength(3);
      expect(result[0]?.value).toBe("600519");
      expect(result[1]?.value).toBe("000001");
      expect(result[2]?.value).toBe("000002");
    });

    it("应该在请求失败时抛出 DataNotAvailableError", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "服务器错误",
      });

      await expect(client.getAllStockCodes()).rejects.toThrow(
        DataNotAvailableError
      );
    });
  });

  describe("getStock", () => {
    it("应该成功获取单个股票信息", async () => {
      const mockStockData = {
        code: "600519",
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        pb: 10.2,
        eps: 50.3,
        revenue: 1275.5,
        netProfit: 620.8,
        debtRatio: 0.25,
        marketCap: 21000.0,
        floatMarketCap: 20500.0,
        dataDate: "2024-01-15",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockStockData],
      });

      const code = StockCode.create("600519");
      const result = await client.getStock(code);

      expect(result).not.toBeNull();
      expect(result?.code.value).toBe("600519");
      expect(result?.name).toBe("贵州茅台");
      expect(result?.industry).toBe("白酒");
      expect(result?.roe).toBe(0.28);
      expect(result?.pe).toBe(35.5);
      expect(result?.marketCap).toBe(21000.0);
    });

    it("应该在股票不存在时返回 null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "股票不存在",
      });

      const code = StockCode.create("600000"); // 使用有效的股票代码格式
      const result = await client.getStock(code);

      expect(result).toBeNull();
    });

    it("应该正确处理 null 值字段", async () => {
      const mockStockData = {
        code: "000001",
        name: "平安银行",
        industry: "银行",
        sector: "主板",
        roe: null,
        pe: null,
        pb: 0.8,
        eps: 1.5,
        revenue: null,
        netProfit: null,
        debtRatio: null,
        marketCap: 3000.0,
        floatMarketCap: 2900.0,
        dataDate: "2024-01-15",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockStockData],
      });

      const code = StockCode.create("000001");
      const result = await client.getStock(code);

      expect(result).not.toBeNull();
      expect(result?.roe).toBeNull();
      expect(result?.pe).toBeNull();
      expect(result?.pb).toBe(0.8);
      expect(result?.revenue).toBeNull();
    });
  });

  describe("getStocksByCodes", () => {
    it("应该成功批量获取股票信息", async () => {
      const mockStocksData = [
        {
          code: "600519",
          name: "贵州茅台",
          industry: "白酒",
          sector: "主板",
          roe: 0.28,
          pe: 35.5,
          pb: 10.2,
          eps: 50.3,
          revenue: 1275.5,
          netProfit: 620.8,
          debtRatio: 0.25,
          marketCap: 21000.0,
          floatMarketCap: 20500.0,
          dataDate: "2024-01-15",
        },
        {
          code: "000001",
          name: "平安银行",
          industry: "银行",
          sector: "主板",
          roe: 0.12,
          pe: 5.5,
          pb: 0.8,
          eps: 1.5,
          revenue: 1800.0,
          netProfit: 400.0,
          debtRatio: 0.92,
          marketCap: 3000.0,
          floatMarketCap: 2900.0,
          dataDate: "2024-01-15",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStocksData,
      });

      const codes = [StockCode.create("600519"), StockCode.create("000001")];
      const result = await client.getStocksByCodes(codes);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/stocks/batch`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ codes: ["600519", "000001"] }),
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.code.value).toBe("600519");
      expect(result[1]?.code.value).toBe("000001");
    });

    it("应该在空列表时返回空数组", async () => {
      const result = await client.getStocksByCodes([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("应该在批量请求失败时抛出 DataNotAvailableError", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "批量查询失败",
      });

      const codes = [StockCode.create("600519")];

      await expect(client.getStocksByCodes(codes)).rejects.toThrow(
        DataNotAvailableError
      );
    });
  });

  describe("getAvailableIndustries", () => {
    it("应该成功获取行业列表", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      const mockResponse = {
        industries: ["白酒", "银行", "医药", "科技"],
        total: 4,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.getAvailableIndustries();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/stocks/industries`,
        expect.anything()
      );

      expect(result).toEqual(["白酒", "银行", "医药", "科技"]);
    });
  });

  describe("getIndicatorHistory", () => {
    it("应该成功获取历史指标数据", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      const mockHistoryData = [
        {
          date: "2021-12-31",
          value: 1094.2,
          isEstimated: false,
        },
        {
          date: "2022-12-31",
          value: 1212.6,
          isEstimated: false,
        },
        {
          date: "2023-12-31",
          value: 1275.5,
          isEstimated: false,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistoryData,
      });

      const code = StockCode.create("600519");
      const result = await client.getIndicatorHistory(
        code,
        IndicatorField.REVENUE,
        3
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/stocks/600519/history?indicator=${IndicatorField.REVENUE}&years=3`,
        expect.anything()
      );

      expect(result).toHaveLength(3);
      expect(result[0]?.value).toBe(1094.2);
      expect(result[0]?.isEstimated).toBe(false);
      expect(result[1]?.value).toBe(1212.6);
      expect(result[2]?.value).toBe(1275.5);
    });

    it("应该正确处理 null 值", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      const mockHistoryData = [
        {
          date: "2021-12-31",
          value: 100.0,
          isEstimated: false,
        },
        {
          date: "2022-12-31",
          value: null,
          isEstimated: true,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistoryData,
      });

      const code = StockCode.create("600519");
      const result = await client.getIndicatorHistory(
        code,
        IndicatorField.ROE,
        2
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.value).toBe(100.0);
      expect(result[1]?.value).toBe(0); // null 映射为 0
      expect(result[1]?.isEstimated).toBe(true);
    });
  });

  describe("错误处理", () => {
    it("应该在网络错误时抛出 DataNotAvailableError", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.getAllStockCodes()).rejects.toThrow(
        DataNotAvailableError
      );
      
      mockFetch.mockClear();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await expect(client.getAllStockCodes()).rejects.toThrow(
        "Python 数据服务请求失败"
      );
    });

    it("应该在超时时抛出 DataNotAvailableError", async () => {
      mockFetch.mockClear();
      const shortTimeoutClient = new PythonDataServiceClient({
        baseUrl,
        timeout: 100,
      });

      // 模拟 AbortError
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      await expect(shortTimeoutClient.getAllStockCodes()).rejects.toThrow(
        DataNotAvailableError
      );
      await expect(shortTimeoutClient.getAllStockCodes()).rejects.toThrow(
        "超时"
      );
    });

    it("应该在 HTTP 错误时包含状态码", async () => {
      mockFetch.mockClear(); // 清除之前的 mock
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "服务不可用",
      });

      try {
        await client.getAllStockCodes();
        expect.fail("应该抛出异常");
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotAvailableError);
        expect((error as DataNotAvailableError).statusCode).toBe(503);
      }
    });
  });

  describe("配置", () => {
    it("应该移除 baseUrl 末尾的斜杠", () => {
      const clientWithSlash = new PythonDataServiceClient({
        baseUrl: "http://localhost:8000/",
        timeout: 5000,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ codes: [], total: 0 }),
      });

      void clientWithSlash.getAllStockCodes();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8000/stocks/codes",
        expect.anything()
      );
    });

    it("应该使用默认超时时间", () => {
      const clientWithDefaultTimeout = new PythonDataServiceClient({
        baseUrl,
      });

      expect(clientWithDefaultTimeout).toBeDefined();
    });
  });
});
