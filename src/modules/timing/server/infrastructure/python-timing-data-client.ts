import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/modules/research/server/domain/workflow/errors";
import type {
  MarketContextSnapshot,
  TimingBarsData,
  TimingSignalBatchData,
  TimingSignalData,
} from "~/modules/timing/server/domain/types";
import { env } from "~/platform/env";

type GatewayResponse<T> = {
  data: T;
};

type GatewayErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type PythonTimingDataClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

function resolveTimingServiceBasePath(rawBaseUrl: string) {
  const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");

  if (normalizedBaseUrl.endsWith("/api/v1/timing")) {
    return {
      baseUrl: normalizedBaseUrl,
      timingBasePath: "",
    };
  }

  if (normalizedBaseUrl.endsWith("/api/v1")) {
    return {
      baseUrl: normalizedBaseUrl,
      timingBasePath: "/timing",
    };
  }

  if (normalizedBaseUrl.endsWith("/api")) {
    return {
      baseUrl: normalizedBaseUrl,
      timingBasePath: "/v1/timing",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    timingBasePath: "/api/v1/timing",
  };
}

export class PythonTimingDataClient {
  private readonly baseUrl: string;
  private readonly timingBasePath: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonTimingDataClientConfig) {
    const resolvedBaseUrl = resolveTimingServiceBasePath(
      config?.baseUrl ?? env.PYTHON_SERVICE_URL,
    );

    this.baseUrl = resolvedBaseUrl.baseUrl;
    this.timingBasePath = resolvedBaseUrl.timingBasePath;
    this.timeoutMs = config?.timeoutMs ?? env.PYTHON_SERVICE_TIMEOUT_MS;
  }

  private timingPath(path: string) {
    return `${this.timingBasePath}${path}`;
  }

  async getBars(params: {
    stockCode: string;
    start?: string;
    end?: string;
    timeframe?: "DAILY";
    adjust?: string;
  }) {
    const search = new URLSearchParams();
    if (params.start) {
      search.set("start", params.start);
    }
    if (params.end) {
      search.set("end", params.end);
    }
    search.set("timeframe", params.timeframe ?? "DAILY");
    search.set("adjust", params.adjust ?? "qfq");

    return this.request<TimingBarsData>(
      this.timingPath(`/stocks/${params.stockCode}/bars?${search.toString()}`),
    );
  }

  async getSignal(params: {
    stockCode: string;
    asOfDate?: string;
    lookbackDays?: number;
    includeBars?: boolean;
  }) {
    const search = new URLSearchParams();
    if (params.asOfDate) {
      search.set("asOfDate", params.asOfDate);
    }
    if (params.lookbackDays) {
      search.set("lookbackDays", String(params.lookbackDays));
    }
    if (params.includeBars) {
      search.set("includeBars", "true");
    }

    const query = search.toString();
    return this.request<TimingSignalData>(
      this.timingPath(
        `/stocks/${params.stockCode}/signals${query ? `?${query}` : ""}`,
      ),
    );
  }

  async getSignalsBatch(params: {
    stockCodes: string[];
    asOfDate?: string;
    lookbackDays?: number;
    includeBars?: boolean;
  }) {
    return this.request<TimingSignalBatchData>(
      this.timingPath("/stocks/signals/batch"),
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
  }

  async getMarketContext(params?: { asOfDate?: string }) {
    const search = new URLSearchParams();
    if (params?.asOfDate) {
      search.set("asOfDate", params.asOfDate);
    }

    const query = search.toString();
    return this.request<MarketContextSnapshot>(
      this.timingPath(`/market/context${query ? `?${query}` : ""}`),
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "未知错误");
        let errorMessage = errorText;

        try {
          const payload = JSON.parse(errorText) as GatewayErrorResponse;
          errorMessage = payload.error?.message ?? errorText;
        } catch {
          errorMessage = errorText;
        }

        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
          `Timing 数据服务异常(${response.status}): ${errorMessage}`,
        );
      }

      const payload = (await response.json()) as GatewayResponse<T>;
      return payload.data;
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
          `Timing 数据服务请求超时 (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
        `Timing 数据服务请求失败: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
