import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { summarizeValue, truncateText } from "./json";
import type { PythonGatewayClient } from "./python-gateway-client";
import type { WebInternalClient } from "./web-internal-client";

type ToolFactoryOptions = {
  pythonGatewayClient: PythonGatewayClient;
  webInternalClient: WebInternalClient;
  runId: string;
  userId: string;
  toolTimeoutMs: number;
};

export const STANDARD_INTERNAL_TOOL_NAMES = [
  "ask_user",
  "internal_web_search", "internal_web_fetch", "internal_concept_match", "internal_screening_query",
  "internal_research_targets_list", "internal_research_target_detail", "internal_research_notes_list",
  "internal_research_artifacts_list", "internal_watchlist_detail", "internal_stock_search", "internal_stock_profile",
  "internal_stock_bars", "internal_stock_daily_basic", "internal_index_market", "internal_index_constituents",
  "internal_moneyflow", "internal_market_events", "internal_shareholder_events", "internal_financial_statements",
  "internal_financial_indicators", "internal_earnings_events", "internal_fund_market", "internal_convertible_bond_market",
  "internal_macro_rates",
] as const;

function asTextResult(details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return {
    content: [
      {
        type: "text",
        text: truncateText(JSON.stringify(details, null, 2), 6000),
      },
    ],
    details,
  };
}


function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export function createInternalTools(options: ToolFactoryOptions): AgentTool[] {
  const callPython = async (
    toolName: string,
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    const timeout = withTimeout(signal, options.toolTimeoutMs);

    try {
      const response = await options.pythonGatewayClient.postJson(
        path,
        body,
        timeout.signal,
      );
      return asTextResult({
        source: "python-service",
        operation: toolName,
        request: summarizeValue(body, 800),
        response: summarizeValue(response),
      });
    } finally {
      timeout.cleanup();
    }
  };

  const callWebInternal = async (
    toolName: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    const timeout = withTimeout(signal, options.toolTimeoutMs);

    try {
      const response = await options.webInternalClient.postToolOperation(
        {
          operation: toolName,
          runId: options.runId,
          userId: options.userId,
          params,
        },
        timeout.signal,
      );
      return asTextResult({
        source: "alphaflow-web",
        operation: toolName,
        request: summarizeValue(params, 800),
        response: summarizeValue(response),
      });
    } finally {
      timeout.cleanup();
    }
  };

  const optionalString = () => Type.Optional(Type.String());
  const includeList = () => Type.Optional(Type.Any());

  return [
    {
      name: "ask_user",
      label: "向用户提问",
      description: "当继续执行必须依赖用户补充的信息时，向用户提出一个明确问题并等待回答。调用后立即结束本次运行。",
      parameters: Type.Object({
        question: Type.String({ minLength: 1, maxLength: 2000 }),
        options: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ minLength: 1 }),
              value: Type.String({ minLength: 1 }),
            }),
            { maxItems: 6 },
          ),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const input = params as {
          question: string;
          options?: Array<{ label: string; value: string }>;
        };
        const question = input.question.trim();
        const options = input.options
          ?.map((option) => ({
            label: option.label.trim(),
            value: option.value.trim(),
          }))
          .filter((option) => option.label && option.value);

        if (question.length < 1 || question.length > 2000) {
          throw new Error("ask_user 的 question 长度必须为 1～2000 个字符");
        }
        if (options && options.length > 6) {
          throw new Error("ask_user 最多只能提供 6 个选项");
        }

        const details = {
          question,
          ...(options && options.length > 0 ? { options } : {}),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
          terminate: true,
        };
      },
    },
    {
      name: "internal_tushare_dataset",
      label: "受限 TuShare 数据集",
      description: "按定时执行计划中的数据集白名单查询 TuShare，不能访问计划外数据集。",
      parameters: Type.Object({
        dataset: Type.String({ minLength: 1 }),
        params: Type.Optional(Type.Record(Type.String(), Type.Any())),
        maxRows: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
      }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { dataset: string; params?: Record<string, unknown>; maxRows?: number };
        const tsCode = input.params?.ts_code;
        if (tsCode !== undefined &&
          (typeof tsCode !== "string" || !/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode))) {
          throw new Error("INVALID_TUSHARE_TS_CODE: ts_code 必须是完整 TuShare 代码，例如 601138.SH、000001.SZ 或 920001.BJ");
        }
        return callPython("internal_tushare_dataset", "/api/v1/capabilities/tushare/query-dataset", {
          dataset: input.dataset,
          params: input.params ?? {},
          maxRows: Math.min(input.maxRows ?? 500, 500),
        }, signal);
      },
    },
    {
      name: "internal_web_search",
      label: "内部网页检索",
      description: "通过 AlphaFlow 内部数据网关检索网页、新闻和行业资料。",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
      }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { query: string; limit?: number };
        return callPython(
          "internal_web_search",
          "/api/v1/capabilities/web/search",
          {
            queries: [input.query],
            limit: input.limit ?? 5,
          },
          signal,
        );
      },
    },
    {
      name: "internal_web_fetch",
      label: "内部网页读取",
      description: "通过 AlphaFlow 内部数据网关读取指定 URL 的网页内容。",
      parameters: Type.Object({
        url: Type.String({ minLength: 1 }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { url: string; approvedAddresses: string[] };
        return callPython(
          "internal_web_fetch",
          "/api/v1/capabilities/web/fetch",
          {
            url: input.url,
            approvedAddresses: input.approvedAddresses,
          },
          signal,
        );
      },
    },
    {
      name: "internal_concept_match",
      label: "内部概念映射",
      description: "把研究主题映射到 AlphaFlow 内部题材、概念或候选方向。",
      parameters: Type.Object({
        theme: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { theme: string; limit?: number };
        return callPython(
          "internal_concept_match",
          "/api/v1/capabilities/concepts/match",
          {
            theme: input.theme,
            limit: input.limit ?? 8,
          },
          signal,
        );
      },
    },
    {
      name: "internal_screening_query",
      label: "内部筛选查询",
      description:
        "调用 AlphaFlow 内部筛选数据网关。payload 必须符合筛选 query-dataset 合约。",
      parameters: Type.Object({
        payload: Type.Record(Type.String(), Type.Any()),
      }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { payload: Record<string, unknown> };
        return callPython(
          "internal_screening_query",
          "/api/v1/capabilities/screening/query-dataset",
          input.payload,
          signal,
        );
      },
    },
    {
      name: "internal_research_targets_list",
      label: "内部投研对象列表",
      description:
        "读取当前用户收藏的投研对象概要，包括收藏公司、收藏行业和自选股。普通查看收藏对象时优先使用此工具。",
      parameters: Type.Object({
        types: Type.Optional(Type.Any()),
        query: optionalString(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_toolCallId, params, signal) =>
        callWebInternal(
          "internal_research_targets_list",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_research_target_detail",
      label: "内部投研对象详情",
      description:
        "读取当前用户某个投研对象的核心详情和关联内容计数，不返回完整长笔记或完整长报告。",
      parameters: Type.Object({
        targetRef: Type.Record(Type.String(), Type.Any()),
      }),
      execute: async (_toolCallId, params, signal) =>
        callWebInternal(
          "internal_research_target_detail",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_research_notes_list",
      label: "内部投研笔记列表",
      description:
        "读取当前用户投研笔记摘要。需要基于已有笔记继续分析、补充风险或整理问题时使用。",
      parameters: Type.Object({
        targetRef: Type.Optional(Type.Record(Type.String(), Type.Any())),
        query: optionalString(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
        contentLimit: Type.Optional(Type.Number({ minimum: 100, maximum: 2000 })),
      }),
      execute: async (_toolCallId, params, signal) =>
        callWebInternal(
          "internal_research_notes_list",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_research_artifacts_list",
      label: "内部研究报告列表",
      description:
        "读取当前用户已保存研究报告的摘要。需要参考已有报告继续分析或比较时使用。",
      parameters: Type.Object({
        targetRef: Type.Optional(Type.Record(Type.String(), Type.Any())),
        artifactType: optionalString(),
        query: optionalString(),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
        contentLimit: Type.Optional(Type.Number({ minimum: 100, maximum: 2000 })),
      }),
      execute: async (_toolCallId, params, signal) =>
        callWebInternal(
          "internal_research_artifacts_list",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_watchlist_detail",
      label: "内部自选股详情",
      description:
        "读取当前用户某个自选股列表的成员、备注和标签。分析自选股组合前先用此工具确认对象。",
      parameters: Type.Object({
        watchListId: Type.String({ minLength: 1 }),
        stockLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        stockOffset: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
      }),
      execute: async (_toolCallId, params, signal) =>
        callWebInternal(
          "internal_watchlist_detail",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_stock_search",
      label: "内部股票搜索",
      description: "按代码、名称、拼音或行业搜索 A 股基础证券信息。",
      parameters: Type.Object({
        keyword: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        listStatus: optionalString(),
        exchange: optionalString(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_stock_search",
          "/api/v1/capabilities/market/stock/search",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_stock_profile",
      label: "内部股票画像",
      description: "读取单只股票基础资料和上市公司经营资料。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        includeCompany: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_stock_profile",
          "/api/v1/capabilities/market/stock/profile",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_stock_bars",
      label: "内部股票行情",
      description: "读取单只股票日线、周线或月线行情。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        freq: optionalString(),
        adjust: optionalString(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_stock_bars",
          "/api/v1/capabilities/market/stock/bars",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_stock_daily_basic",
      label: "内部股票每日指标",
      description: "读取股票估值、换手率、市值、涨跌停状态等每日基本面指标。",
      parameters: Type.Object({
        stockCode: optionalString(),
        tradeDate: optionalString(),
        startDate: optionalString(),
        endDate: optionalString(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_stock_daily_basic",
          "/api/v1/capabilities/market/stock/daily-basic",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_index_market",
      label: "内部指数行情",
      description: "读取指数基础信息、行情和估值指标。",
      parameters: Type.Object({
        indexCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        includeBasic: Type.Optional(Type.Boolean()),
        includeValuation: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_index_market",
          "/api/v1/capabilities/market/index/market",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_index_constituents",
      label: "内部指数成分",
      description: "读取指数成分股和权重。",
      parameters: Type.Object({
        indexCode: Type.String({ minLength: 1 }),
        tradeDate: optionalString(),
        startDate: optionalString(),
        endDate: optionalString(),
        includeNames: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_index_constituents",
          "/api/v1/capabilities/market/index/constituents",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_moneyflow",
      label: "内部资金流",
      description: "读取个股资金流、两融和沪深股通持股数据。",
      parameters: Type.Object({
        stockCode: optionalString(),
        tradeDate: optionalString(),
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_moneyflow",
          "/api/v1/capabilities/market/stock/moneyflow",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_market_events",
      label: "内部市场事件",
      description: "读取龙虎榜、大宗交易、涨跌停价格等市场事件。",
      parameters: Type.Object({
        tradeDate: Type.String({ minLength: 8 }),
        stockCode: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_market_events",
          "/api/v1/capabilities/market/events",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_shareholder_events",
      label: "内部股东事件",
      description: "读取股东户数、增减持、质押、解禁和回购事件。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_shareholder_events",
          "/api/v1/capabilities/market/stock/shareholder-events",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_financial_statements",
      label: "内部三大报表",
      description: "读取利润表、资产负债表和现金流量表核心字段。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        period: optionalString(),
        statement: optionalString(),
        reportType: optionalString(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_financial_statements",
          "/api/v1/capabilities/market/stock/financial-statements",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_financial_indicators",
      label: "内部财务指标",
      description: "读取盈利、成长、偿债、现金流、主营构成和审计意见。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        period: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_financial_indicators",
          "/api/v1/capabilities/market/stock/financial-indicators",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_earnings_events",
      label: "内部业绩事件",
      description: "读取业绩预告、快报、披露预约和分红送转。",
      parameters: Type.Object({
        stockCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_earnings_events",
          "/api/v1/capabilities/market/stock/earnings-events",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_fund_market",
      label: "内部基金市场",
      description: "读取基金基础信息、净值、行情和持仓。",
      parameters: Type.Object({
        fundCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_fund_market",
          "/api/v1/capabilities/market/fund/market",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_convertible_bond_market",
      label: "内部可转债市场",
      description: "读取可转债基础条款、发行信息和行情。",
      parameters: Type.Object({
        bondCode: Type.String({ minLength: 1 }),
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_convertible_bond_market",
          "/api/v1/capabilities/market/convertible-bond/market",
          params as Record<string, unknown>,
          signal,
        ),
    },
    {
      name: "internal_macro_rates",
      label: "内部宏观利率",
      description: "读取 SHIBOR、LPR、LIBOR、HIBOR 等利率序列。",
      parameters: Type.Object({
        startDate: optionalString(),
        endDate: optionalString(),
        include: includeList(),
      }),
      execute: async (_toolCallId, params, signal) =>
        callPython(
          "internal_macro_rates",
          "/api/v1/capabilities/market/macro/rates",
          params as Record<string, unknown>,
          signal,
        ),
    },
  ];
}
