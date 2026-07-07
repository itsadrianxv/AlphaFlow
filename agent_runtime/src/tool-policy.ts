import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { summarizeValue, truncateText } from "./json";
import type { PythonGatewayClient } from "./python-gateway-client";

type ToolFactoryOptions = {
  pythonGatewayClient: PythonGatewayClient;
  maxToolCalls: number;
  toolTimeoutMs: number;
};

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

function createToolGuard(maxToolCalls: number) {
  let toolCallCount = 0;

  return (toolName: string) => {
    toolCallCount += 1;
    if (toolCallCount > maxToolCalls) {
      throw new Error(`工具调用次数超过上限: ${toolName}`);
    }
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
  const guard = createToolGuard(options.maxToolCalls);

  const callPython = async (
    toolName: string,
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    guard(toolName);
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

  return [
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
        const input = params as { url: string };
        return callPython(
          "internal_web_fetch",
          "/api/v1/capabilities/web/fetch",
          {
            url: input.url,
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
  ];
}
