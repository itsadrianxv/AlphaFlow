import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { AgentExecutionFactory } from "../src/agent-execution";
import {
  AgentRunner,
  type AgentExecutionAdapter,
  type AgentRunPlan,
  type RunnerEvent,
} from "../src/agent-runner";

function createPlan(): AgentRunPlan {
  const execution = new AgentExecutionFactory({
    modeCapabilities: {
      research: ["internal_web_search"],
      scheduled_task_setup: [],
      scheduled_task_edit: [],
      scheduled_task_execution: [],
    },
    createAdapters: () => [
      {
        name: "internal_web_search",
        label: "search",
        description: "search",
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: {} }),
      },
    ],
  }).create({
    runId: "run-1",
    userId: "user-1",
    objective: "只读即时研究",
    input: { symbol: "000001.SZ" },
    skillIds: ["research"],
    interactionMode: "research",
    policy: { requestedCapabilities: ["internal_web_search"] },
    model: { provider: "test", id: "test-model" },
  });
  return {
  runKind: "immediate_research",
  runId: "run-1",
  userId: "user-1",
  prompt: "分析公司公告",
  context: { symbol: "000001.SZ" },
  execution,
  skills: [
    {
      id: "research",
      description: "研究公司",
      content: "只使用可追溯证据",
      referencesRoot: "skills/research",
    },
  ],
  session: { mode: "memory", id: "run-1", seed: [] },
  };
}

describe("AgentRunner", () => {
  it("通过稳定 interface 返回完成结果和执行审计", async () => {
    const plan = createPlan();
    const observedEvents: RunnerEvent[] = [];
    const adapter: AgentExecutionAdapter = {
      execute: async ({ emit, plan }) => {
        emit({ type: "message.started" });
        await plan.execution.capabilities()[0]?.execute("tool-1", {});
        emit({
          type: "tool.started",
          toolCallId: "tool-1",
          toolName: "internal_web_search",
          inputSummary: { query: "公告" },
        });
        emit({
          type: "tool.completed",
          toolCallId: "tool-1",
          toolName: "internal_web_search",
          inputSummary: { query: "公告" },
          outputSummary: { preview: "公告摘要" },
        });
        return {
          kind: "completed",
          text: "研究结论",
          usage: { inputTokens: 120, outputTokens: 40 },
          evidenceGaps: ["缺少管理层电话会原文"],
        };
      },
    };

    const result = await new AgentRunner(adapter).run({
      plan,
      signal: new AbortController().signal,
      emit: (event) => observedEvents.push(event),
    });

    expect(result).toMatchObject({
      kind: "completed",
      output: { text: "研究结论" },
      evidenceGaps: ["缺少管理层电话会原文"],
      audit: {
        boundary: plan.execution.snapshot,
        stopReason: "completed",
        usage: {
          steps: 1,
          inputTokens: 120,
          outputTokens: 40,
          toolCalls: 1,
          peakConcurrentSubtasks: 0,
        },
      },
    });
    expect(result.audit.toolSummaries).toEqual([
      expect.objectContaining({
        toolCallId: "tool-1",
        toolName: "internal_web_search",
      }),
    ]);
    expect(observedEvents.map((event) => event.type)).toEqual([
      "message.started",
      "tool.started",
      "tool.completed",
    ]);
    await expect(plan.execution.acquireSubtask()).rejects.toThrow("已暂停");
  });

  it("把等待用户输入作为显式停止结果返回", async () => {
    const plan = createPlan();
    const adapter: AgentExecutionAdapter = {
      execute: async () => ({
        kind: "waiting_for_input",
        inputRequest: {
          question: "需要分析哪家公司？",
          options: [{ label: "平安银行", value: "000001.SZ" }],
        },
        usage: { inputTokens: 60, outputTokens: 12 },
        evidenceGaps: ["缺少分析标的"],
      }),
    };

    const result = await new AgentRunner(adapter).run({
      plan,
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(result).toMatchObject({
      kind: "waiting_for_input",
      inputRequest: { question: "需要分析哪家公司？" },
      resumeToken: "run-1",
      evidenceGaps: ["缺少分析标的"],
      audit: { stopReason: "waiting_for_input" },
    });
  });

  it("把执行失败作为带部分结果的统一停止结果返回", async () => {
    const plan = createPlan();
    const adapter: AgentExecutionAdapter = {
      execute: async () => ({
        kind: "stopped",
        stopReason: "model_error",
        error: { code: "MODEL_TIMEOUT", message: "模型请求超时" },
        partialText: "已经核实的部分事实",
        usage: { inputTokens: 80, outputTokens: 20 },
        evidenceGaps: ["模型未完成反向情景"],
      }),
    };

    const result = await new AgentRunner(adapter).run({
      plan,
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(result).toMatchObject({
      kind: "stopped",
      stopReason: "model_error",
      error: { code: "MODEL_TIMEOUT", message: "模型请求超时" },
      partialOutput: { text: "已经核实的部分事实" },
      evidenceGaps: ["模型未完成反向情景"],
      audit: { stopReason: "model_error" },
    });
  });

  it("大量 Token 只进入观测，不改变完成结果", async () => {
    const plan = createPlan();
    const adapter: AgentExecutionAdapter = {
      execute: async () => ({
        kind: "completed",
        text: "部分结论",
        usage: { inputTokens: 1_200_000, outputTokens: 500_001 },
        evidenceGaps: [],
      }),
    };

    const result = await new AgentRunner(adapter).run({
      plan,
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(result).toMatchObject({
      kind: "completed",
      output: { text: "部分结论" },
      audit: {
        stopReason: "completed",
        usage: { inputTokens: 1_200_000, outputTokens: 500_001 },
      },
    });
  });
});
