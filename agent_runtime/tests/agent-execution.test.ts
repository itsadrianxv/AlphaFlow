import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { AGENT_MODE_CAPABILITIES } from "../src/agent-capability-registry";
import {
  AgentExecutionFactory,
  type AgentExecutionSnapshot,
} from "../src/agent-execution";
import type { AgentInteractionMode, AgentPolicyRequest } from "../src/types";

const EXPECTED_MODE_CAPABILITIES = {
  research: [
    "ask_user", "internal_web_search", "internal_web_fetch", "internal_concept_match", "internal_screening_query",
    "internal_research_targets_list", "internal_research_target_detail", "internal_research_notes_list",
    "internal_research_artifacts_list", "internal_watchlist_detail", "internal_stock_search", "internal_stock_profile",
    "internal_stock_bars", "internal_stock_daily_basic", "internal_index_market", "internal_index_constituents",
    "internal_moneyflow", "internal_market_events", "internal_shareholder_events", "internal_financial_statements",
    "internal_financial_indicators", "internal_earnings_events", "internal_fund_market", "internal_convertible_bond_market",
    "internal_macro_rates",
  ],
  scheduled_task_setup: [
    "list_schedule_capabilities", "inspect_schedule_capability", "validate_schedule", "resolve_user_scope",
    "build_scheduled_task_draft", "build_scheduled_task_edit_draft", "ask_user",
  ],
  scheduled_task_edit: [
    "list_schedule_capabilities", "inspect_schedule_capability", "validate_schedule", "resolve_user_scope",
    "build_scheduled_task_draft", "build_scheduled_task_edit_draft", "ask_user",
  ],
  scheduled_task_execution: [
    "internal_web_search", "internal_web_fetch", "internal_concept_match", "internal_screening_query",
    "internal_research_targets_list", "internal_research_target_detail", "internal_research_notes_list",
    "internal_research_artifacts_list", "internal_watchlist_detail", "internal_stock_search", "internal_stock_profile",
    "internal_stock_bars", "internal_stock_daily_basic", "internal_index_market", "internal_index_constituents",
    "internal_moneyflow", "internal_market_events", "internal_shareholder_events", "internal_financial_statements",
    "internal_financial_indicators", "internal_earnings_events", "internal_fund_market", "internal_convertible_bond_market",
    "internal_macro_rates", "internal_tushare_dataset",
  ],
} satisfies Record<AgentInteractionMode, string[]>;

function tool(name: string, execute = vi.fn(async () => ({ content: [], details: {} }))): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute,
  };
}

function factory() {
  const tools = [...new Set(Object.values(EXPECTED_MODE_CAPABILITIES).flat())].map((name) =>
    tool(name),
  );
  return new AgentExecutionFactory({
    modeCapabilities: AGENT_MODE_CAPABILITIES,
    createAdapters: () => tools,
    resolveHost: async () => ["93.184.216.34"],
  });
}

function create(
  interactionMode: AgentInteractionMode,
  policy?: AgentPolicyRequest,
) {
  const effectivePolicy =
    interactionMode === "scheduled_task_execution" && policy === undefined
      ? {
          capabilityConstraints: {
            internal_tushare_dataset: {
              allowedDatasets: ["moneyflow"],
              maxRows: 10,
              maxLookbackDays: 30,
            },
          },
        }
      : policy;
  return factory().create({
    runId: `run-${interactionMode}`,
    userId: "user-test",
    objective: "执行研究任务",
    input: { prompt: "研究" },
    skillIds: ["research"],
    interactionMode,
    policy: effectivePolicy,
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
  });
}

describe("AgentExecution 能力冻结", () => {
  it.each(Object.entries(EXPECTED_MODE_CAPABILITIES))(
    "%s 模式只暴露唯一目录中定义的默认能力",
    (mode, expected) => {
      const execution = create(mode as AgentInteractionMode);
      expect(execution.capabilities().map((item) => item.name).sort()).toEqual(
        [...expected].sort(),
      );
    },
  );

  it("显式空集合会收窄为无能力，而不是回退默认值", () => {
    const execution = create("research", { requestedCapabilities: [] });
    expect(execution.capabilities()).toEqual([]);
  });

  it("只接受模式上限的子集，并拒绝未知或扩权能力", () => {
    expect(
      create("research", { requestedCapabilities: ["internal_web_search"] })
        .capabilities()
        .map((item) => item.name),
    ).toEqual(["internal_web_search"]);
    expect(() =>
      create("research", { requestedCapabilities: ["internal_tushare_dataset"] }),
    ).toThrow("能力不在 interaction mode 上限内");
    expect(() =>
      create("research", { requestedCapabilities: ["unknown"] }),
    ).toThrow("未知能力");
  });

  it("包装能力在执行时再次校验冻结授权", async () => {
    const execution = create("research", {
      requestedCapabilities: ["internal_web_search"],
    });
    const snapshot = execution.snapshot as AgentExecutionSnapshot & {
      capabilities: string[];
    };
    snapshot.capabilities.push("internal_web_fetch");

    expect(execution.capabilities().map((item) => item.name)).toEqual([
      "internal_web_search",
    ]);
    await expect(
      execution.executeCapability("internal_web_fetch", "forged", {}),
    ).rejects.toThrow("能力未授权");
  });
});

describe("AgentExecution 类型化约束与网络 enforcement", () => {
  it("策略请求的未知字段和非法成本阈值会 fail-closed", () => {
    expect(() =>
      create("research", { unexpected: true } as never),
    ).toThrow("未知策略字段");
    expect(() =>
      create("research", { network: { unexpected: true } } as never),
    ).toThrow("未知网络策略字段");
    expect(() =>
      create("research", {
        network: { allowPrivateNetwork: "yes" },
      } as never),
    ).toThrow("allowPrivateNetwork 非法");
    expect(() =>
      create("research", {
        network: { allowCredentialedUrls: 1 },
      } as never),
    ).toThrow("allowCredentialedUrls 非法");
    expect(() =>
      create("research", {
        costWarning: { currency: "CNY", micros: -1 },
      } as never),
    ).toThrow("costWarning 非法");
  });

  it("未知、越权、非法和缺失的 constraint 都会 fail-closed", () => {
    expect(() =>
      create("research", {
        capabilityConstraints: { unknown: {} } as never,
      }),
    ).toThrow("未知 capability constraint");
    expect(() =>
      create("research", {
        capabilityConstraints: {
          internal_tushare_dataset: {
            allowedDatasets: ["moneyflow"],
            maxRows: 10,
            maxLookbackDays: 30,
          },
        },
      }),
    ).toThrow("未授权能力的 constraint");
    expect(() =>
      create("scheduled_task_execution", {
        requestedCapabilities: ["internal_tushare_dataset"],
      }),
    ).toThrow("缺少必需 constraint");
    expect(() =>
      create("scheduled_task_execution", {
        requestedCapabilities: ["internal_tushare_dataset"],
        capabilityConstraints: {
          internal_tushare_dataset: {
            allowedDatasets: ["moneyflow"],
            unexpected: true,
          } as never,
        },
      }),
    ).toThrow("未知字段");
  });

  it.each([
    "http://localhost/data",
    "http://127.0.0.1/data",
    "http://0.0.0.0/data",
    "http://10.0.0.1/data",
    "http://172.16.0.1/data",
    "http://192.168.1.1/data",
    "http://[::1]/data",
    "http://[fd00::1]/data",
    "http://[fe80::1]/data",
    "http://[::ffff:127.0.0.1]/data",
    "ftp://example.com/data",
    "https://user:secret@example.com/data",
  ])("同一包装执行路径拒绝不安全 URL: %s", async (url) => {
    const execution = create("research", {
      requestedCapabilities: ["internal_web_fetch"],
    });
    await expect(
      execution.executeCapability("internal_web_fetch", "call", { url }),
    ).rejects.toThrow("网络策略拒绝");
  });

  it("允许获准的公开 HTTP(S)，网络请求只能进一步收窄", async () => {
    const execution = create("research", {
      requestedCapabilities: ["internal_web_fetch"],
      network: { allowedSchemes: ["https"] },
    });
    await expect(
      execution.executeCapability("internal_web_fetch", "call", {
        url: "https://example.com/report",
      }),
    ).resolves.toBeDefined();
    await expect(
      execution.executeCapability("internal_web_fetch", "call", {
        url: "http://example.com/report",
      }),
    ).rejects.toThrow("网络策略拒绝");
    expect(() =>
      create("research", {
        network: { allowPrivateNetwork: true } as never,
      }),
    ).toThrow("只能收窄");
  });

  it("拒绝解析到私网地址的普通域名", async () => {
    const execution = new AgentExecutionFactory({
      modeCapabilities: {
        research: ["internal_web_fetch"],
        scheduled_task_setup: [],
        scheduled_task_edit: [],
        scheduled_task_execution: [],
      },
      createAdapters: () => [tool("internal_web_fetch")],
      resolveHost: async () => ["10.0.0.8"],
    }).create({
      runId: "run-dns-private",
      userId: "user-test",
      objective: "读取公开网页",
      input: {},
      skillIds: ["research"],
      interactionMode: "research",
      model: { provider: "test", id: "test" },
    });

    await expect(
      execution.executeCapability("internal_web_fetch", "call", {
        url: "https://public-looking.example/report",
      }),
    ).rejects.toThrow("解析到私网地址");
  });

  it("TuShare 包装能力执行时强制数据集、行数与回看窗口约束", async () => {
    const execution = create("scheduled_task_execution", {
      requestedCapabilities: ["internal_tushare_dataset"],
      capabilityConstraints: {
        internal_tushare_dataset: {
          allowedDatasets: ["moneyflow"],
          maxRows: 10,
          maxLookbackDays: 5,
        },
      },
    });
    await expect(
      execution.executeCapability("internal_tushare_dataset", "call-1", {
        dataset: "income",
      }),
    ).rejects.toThrow("未授权 TuShare 数据集");
    await expect(
      execution.executeCapability("internal_tushare_dataset", "call-2", {
        dataset: "moneyflow",
        maxRows: 11,
      }),
    ).rejects.toThrow("允许的行数");
    await expect(
      execution.executeCapability("internal_tushare_dataset", "call-3", {
        dataset: "moneyflow",
        params: { start_date: "20260701", end_date: "20260720" },
      }),
    ).rejects.toThrow("回看窗口");
    await expect(
      execution.executeCapability("internal_tushare_dataset", "call-4", {
        dataset: "moneyflow",
        params: {},
      }),
    ).rejects.toThrow("必须提供合法的起止日期");
  });

  it("TuShare 省略 maxRows 时向 raw adapter 传入冻结上限", async () => {
    const rawExecute = vi.fn(async () => ({ content: [], details: {} }));
    const execution = new AgentExecutionFactory({
      modeCapabilities: {
        research: [],
        scheduled_task_setup: [],
        scheduled_task_edit: [],
        scheduled_task_execution: ["internal_tushare_dataset"],
      },
      createAdapters: () => [tool("internal_tushare_dataset", rawExecute)],
    }).create({
      runId: "run-tushare-narrowing",
      userId: "user-test",
      objective: "执行数据查询",
      input: {},
      skillIds: ["scheduled-task-execution"],
      interactionMode: "scheduled_task_execution",
      policy: {
        capabilityConstraints: {
          internal_tushare_dataset: {
            allowedDatasets: ["moneyflow"],
            maxRows: 10,
            maxLookbackDays: 30,
          },
        },
      },
      model: { provider: "test", id: "test" },
    });

    await execution.executeCapability("internal_tushare_dataset", "call", {
      dataset: "moneyflow",
      params: { start_date: "20260701", end_date: "20260710" },
    });
    expect(rawExecute).toHaveBeenCalledWith(
      "call",
      {
        dataset: "moneyflow",
        params: { start_date: "20260701", end_date: "20260710" },
        maxRows: 10,
      },
      undefined,
    );
  });
});

describe("AgentExecution 资源许可、观测与恢复", () => {
  it("并发上限限制活跃 permit，release 可重入且暂停会释放", async () => {
    const execution = create("research", { maxConcurrentSubtasks: 1 });
    const first = await execution.acquireSubtask();
    let secondAcquired = false;
    const secondPromise = execution.acquireSubtask().then((permit) => {
      secondAcquired = true;
      return permit;
    });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    first.release();
    first.release();
    const second = await secondPromise;
    expect(secondAcquired).toBe(true);

    const thirdPromise = execution.acquireSubtask();
    execution.pause();
    await expect(thirdPromise).rejects.toThrow("已暂停");
    second.release();
    await expect(execution.acquireSubtask()).rejects.toThrow("已暂停");
    expect(execution.audit().usage.peakConcurrentSubtasks).toBe(1);
  });

  it("已取消的请求不会取得子任务 permit", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      create("research").acquireSubtask(controller.signal),
    ).rejects.toThrow("已取消");
  });

  it("拒绝超过系统 ceiling 的子任务并发额度", () => {
    expect(() =>
      create("research", { maxConcurrentSubtasks: 9 }),
    ).toThrow("超过系统并发上限");
  });

  it("步骤、工具与 Token 只累计观测，成本 unknown 与真实零值可区分", () => {
    const execution = create("research", {
      costWarning: { currency: "USD", micros: 10 },
    });
    execution.observe({ kind: "step", count: 100_000 });
    execution.observe({ kind: "model", inputTokens: 1_000_000, outputTokens: 500_000 });
    expect(execution.audit()).toMatchObject({
      usage: { steps: 100_000, inputTokens: 1_000_000, outputTokens: 500_000 },
      cost: undefined,
      costWarningExceeded: false,
    });
    execution.observe({ kind: "model", costUsd: 0 });
    expect(execution.audit().cost).toEqual({ currency: "USD", micros: 0 });
    execution.observe({ kind: "model", costUsd: 0.000_011 });
    expect(execution.audit()).toMatchObject({
      cost: { currency: "USD", micros: 11 },
      costWarningExceeded: true,
    });
  });

  it("恢复只消费系统 snapshot，并延续冻结策略和累计观测", () => {
    const original = create("research", {
      requestedCapabilities: ["internal_web_search"],
      maxConcurrentSubtasks: 2,
      costWarning: { currency: "USD", micros: 100 },
    });
    original.observe({ kind: "step", count: 3 });
    original.observe({ kind: "model", inputTokens: 20, costUsd: 0.000_05 });
    const snapshot = original.pause();
    const restored = factory().create({
      runId: "run-forged",
      userId: "forged-user",
      objective: "伪造目标",
      input: { prompt: "伪造" },
      skillIds: ["forged"],
      interactionMode: "scheduled_task_execution",
      policy: { requestedCapabilities: ["internal_tushare_dataset"] },
      model: { provider: "forged", id: "forged" },
      snapshot,
    });
    restored.observe({ kind: "step", count: 2 });
    expect(restored.snapshot).toMatchObject({
      runId: "run-research",
      userId: "user-test",
      idempotencyKey: "run-research",
      interactionMode: "research",
      capabilities: ["internal_web_search"],
      maxConcurrentSubtasks: 2,
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      usage: { steps: 5, inputTokens: 20, costMicros: 50 },
    });
  });
});
