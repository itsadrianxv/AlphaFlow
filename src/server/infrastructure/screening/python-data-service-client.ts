/**
 * PythonDataServiceClient
 *
 * 基础设施层 HTTP 客户端，调用 Python FastAPI 数据服务。
 * 实现 IMarketDataRepository 和 IHistoricalDataProvider 接口。
 *
 * 职责：
 * - 通过 HTTP 调用 Python 数据服务的 REST API
 * - 将 JSON 响应映射为领域层的 Stock 实体和 IndicatorDataPoint 值对象
 * - 处理超时和网络错误，转换为 DataNotAvailableError
 *
 * Requirements: 6.4, 6.5
 */

import type { IMarketDataRepository } from "~/server/domain/screening/repositories/market-data-repository.js";
import type {
  IHistoricalDataProvider,
  IndicatorDataPoint,
} from "~/server/domain/screening/repositories/historical-data-provider.js";
import { StockCode } from "~/server/domain/screening/value-objects/stock-code.js";
import { Stock } from "~/server/domain/screening/entities/stock.js";
import { DataNotAvailableError } from "~/server/domain/screening/errors.js";
import type { IndicatorField } from "~/server/domain/screening/enums/indicator-field.js";

/**
 * Python 服务的 StockData 响应接口
 */
interface StockDataResponse {
  code: string;
  name: string;
  industry: string;
  sector: string;
  roe?: number | null;
  pe?: number | null;
  pb?: number | null;
  eps?: number | null;
  revenue?: number | null;
  netProfit?: number | null;
  debtRatio?: number | null;
  marketCap?: number | null;
  floatMarketCap?: number | null;
  dataDate: string;
}

/**
 * Python 服务的 IndicatorDataPoint 响应接口
 */
interface IndicatorDataPointResponse {
  date: string;
  value: number | null;
  isEstimated: boolean;
}

/**
 * Python 服务的股票代码列表响应接口
 */
interface StockCodesResponse {
  codes: string[];
  total: number;
}

/**
 * Python 服务的行业列表响应接口
 */
interface IndustriesResponse {
  industries: string[];
  total: number;
}

/**
 * 批量查询股票请求体
 */
interface BatchStockRequest {
  codes: string[];
}

/**
 * PythonDataServiceClient 配置
 */
export interface PythonDataServiceClientConfig {
  /** Python 服务的基础 URL */
  baseUrl: string;
  /** 请求超时时间（毫秒），默认 10000 */
  timeout?: number;
}

/**
 * Python 数据服务 HTTP 客户端
 *
 * 实现 IMarketDataRepository 和 IHistoricalDataProvider 接口，
 * 通过 HTTP 调用 Python FastAPI 服务获取股票数据。
 */
export class PythonDataServiceClient
  implements IMarketDataRepository, IHistoricalDataProvider
{
  private readonly baseUrl: string;
  private readonly timeout: number;

  /**
   * 构造函数
   * @param config 客户端配置
   */
  constructor(config: PythonDataServiceClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
    this.timeout = config.timeout ?? 10000;
  }

  /**
   * 执行 HTTP 请求的通用方法
   * @param path API 路径
   * @param options fetch 选项
   * @returns 响应 JSON
   * @throws DataNotAvailableError 当请求失败或超时时
   */
  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "未知错误");
        throw new DataNotAvailableError(
          `Python 数据服务返回错误: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof DataNotAvailableError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new DataNotAvailableError(
          `Python 数据服务请求超时 (${this.timeout}ms)`,
          undefined,
          { url, timeout: this.timeout }
        );
      }

      throw new DataNotAvailableError(
        `Python 数据服务请求失败: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  /**
   * 将 StockDataResponse 映射为 Stock 实体
   * @param data Python 服务返回的股票数据
   * @returns Stock 实体
   */
  private mapToStock(data: StockDataResponse): Stock {
    return new Stock({
      code: StockCode.create(data.code),
      name: data.name,
      industry: data.industry,
      sector: data.sector,
      roe: data.roe ?? null,
      pe: data.pe ?? null,
      pb: data.pb ?? null,
      eps: data.eps ?? null,
      revenue: data.revenue ?? null,
      netProfit: data.netProfit ?? null,
      debtRatio: data.debtRatio ?? null,
      marketCap: data.marketCap ?? null,
      floatMarketCap: data.floatMarketCap ?? null,
      dataDate: new Date(data.dataDate),
    });
  }

  /**
   * 将 IndicatorDataPointResponse 映射为 IndicatorDataPoint
   * @param data Python 服务返回的指标数据点
   * @returns IndicatorDataPoint
   */
  private mapToIndicatorDataPoint(
    data: IndicatorDataPointResponse
  ): IndicatorDataPoint {
    return {
      date: new Date(data.date),
      value: data.value ?? 0,
      isEstimated: data.isEstimated,
    };
  }

  // ========== IMarketDataRepository 接口实现 ==========

  /**
   * 获取全市场 A 股股票代码列表
   * @returns 股票代码列表
   */
  async getAllStockCodes(): Promise<StockCode[]> {
    const response = await this.fetch<StockCodesResponse>("/stocks/codes");
    return response.codes.map((code) => StockCode.create(code));
  }

  /**
   * 根据股票代码获取股票信息
   * @param code 股票代码
   * @returns 股票实例或 null（如果不存在）
   */
  async getStock(code: StockCode): Promise<Stock | null> {
    try {
      const stocks = await this.getStocksByCodes([code]);
      return stocks[0] ?? null;
    } catch (error) {
      // 如果是 404 或数据不存在，返回 null
      if (
        error instanceof DataNotAvailableError &&
        error.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 批量获取股票信息
   * @param codes 股票代码列表
   * @returns 股票实例列表
   */
  async getStocksByCodes(codes: StockCode[]): Promise<Stock[]> {
    if (codes.length === 0) {
      return [];
    }

    const request: BatchStockRequest = {
      codes: codes.map((code) => code.value),
    };

    const response = await this.fetch<StockDataResponse[]>("/stocks/batch", {
      method: "POST",
      body: JSON.stringify(request),
    });

    return response.map((data) => this.mapToStock(data));
  }

  /**
   * 获取可用的行业列表
   * @returns 行业名称列表
   */
  async getAvailableIndustries(): Promise<string[]> {
    const response = await this.fetch<IndustriesResponse>(
      "/stocks/industries"
    );
    return response.industries;
  }

  // ========== IHistoricalDataProvider 接口实现 ==========

  /**
   * 获取指定股票的历史指标数据
   *
   * @param stockCode 股票代码
   * @param indicator 指标字段
   * @param years 获取最近 N 年的数据
   * @returns 指标数据点列表（按时间升序排列）
   */
  async getIndicatorHistory(
    stockCode: StockCode,
    indicator: IndicatorField,
    years: number
  ): Promise<IndicatorDataPoint[]> {
    const path = `/stocks/${stockCode.value}/history?indicator=${indicator}&years=${years}`;
    const response =
      await this.fetch<IndicatorDataPointResponse[]>(path);

    return response.map((data) => this.mapToIndicatorDataPoint(data));
  }
}

/**
 * 创建 PythonDataServiceClient 实例的工厂函数
 *
 * @param baseUrl Python 服务的基础 URL，默认从环境变量 PYTHON_SERVICE_URL 读取
 * @param timeout 请求超时时间（毫秒），默认 10000
 * @returns PythonDataServiceClient 实例
 */
export function createPythonDataServiceClient(
  baseUrl?: string,
  timeout?: number
): PythonDataServiceClient {
  const serviceUrl =
    baseUrl ?? process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

  return new PythonDataServiceClient({
    baseUrl: serviceUrl,
    timeout,
  });
}
