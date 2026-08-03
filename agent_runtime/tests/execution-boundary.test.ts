import { describe, expect, it } from "vitest";
import {
  AgentBudgetController,
  createExecutionBoundary,
} from "../src/execution-boundary";
import { AgentRuntimeRunStore } from "../src/run-store";
import type { AgentRuntimeConfig } from "../src/types";

const config: AgentRuntimeConfig = {
  host: "127.0.0.1",
  port: 3010,
  sessionRoot: ".sessions",
  compactionTokenThreshold: 10_000,
  webInternalUrl: "http://web",
  internalApiSecret: "test",
  pythonServiceUrl: "http://python",
  pythonServiceTimeoutMs: 1000,
  runTtlMs: 60_000,
  maxToolCallsPerRun: 3,
  toolTimeoutMs: 1000,
  modelProvider: "deepseek",
  modelId: "deepseek-chat",
  modelTimeoutMs: 30_000,
  modelMaxRetries: 0,
  redisUrl: "redis://localhost:6379",
  scheduledTaskEventStream: "events",
  scheduledTaskEventMaxLen: 100,
};

describe("Agent 执行边界", () => {
  it("冻结目标、输入快照、能力、网络策略、模型和预算", () => {
    const boundary = createExecutionBoundary(
      {
        runId: "run_1",
        userId: "user_1",
        skillId: "research",
        skillIds: ["research"],
        prompt: "分析公司",
        allowedCapabilities: ["internal_web_search"],
        executionBoundary: {
          objective: "只读即时研究",
          inputSnapshotId: "snapshot_1",
          budget: { maxToolCalls: 2, maxConcurrentSubtasks: 1 },
        },
      },
      config,
    );

    expect(boundary.objective).toBe("只读即时研究");
    expect(boundary.inputSnapshot.id).toBe("snapshot_1");
    expect(boundary.inputSnapshot.hash).toMatch(/^fnv1a32:/);
    expect(boundary.allowedCapabilities).toEqual(["internal_web_search"]);
    expect(boundary.networkPolicy).toMatchObject({
      allowPublicHttp: true,
      denyPrivateNetwork: true,
      allowCredentials: false,
    });
    expect(boundary.budget.maxToolCalls).toBe(2);
    expect(boundary.model).toEqual({
      provider: "deepseek",
      id: "deepseek-chat",
    });
  });

  it("阻止未授权工具、预算超限和子任务扩权", () => {
    const boundary = createExecutionBoundary(
      {
        runId: "run_budget",
        userId: "user_1",
        skillId: "research",
        prompt: "研究",
        allowedCapabilities: ["internal_web_search"],
        executionBoundary: {
          budget: { maxToolCalls: 1, maxConcurrentSubtasks: 1 },
        },
      },
      config,
    );
    const budget = new AgentBudgetController(boundary);

    budget.recordToolCall("internal_web_search");
    expect(() => budget.recordToolCall("internal_web_fetch")).toThrow(
      "能力未授权",
    );
    expect(() => budget.recordToolCall("internal_web_search")).toThrow(
      "工具调用预算已耗尽",
    );

    const child = budget.reserveSubtask(["internal_web_search"]);
    expect(child.allowedCapabilities).toEqual(["internal_web_search"]);
    expect(() => budget.reserveSubtask(["internal_web_fetch"])).toThrow(
      "子任务不能扩权",
    );
  });

  it("记录运行审计摘要但不保存隐藏推理", () => {
    const store = new AgentRuntimeRunStore(60_000);
    store.createOrGet({
      runId: "run_audit",
      userId: "user_1",
      skillId: "research",
      prompt: "审计",
    });

    store.recordAudit("run_audit", {
      boundary: { runId: "run_audit", allowedCapabilities: ["tool"] },
      toolSummaries: [{ toolName: "tool", outputSummary: { ok: true } }],
      structuredOutput: { text: "结论" },
      stopReason: "completed",
      usage: {
        steps: 1,
        inputTokens: 10,
        outputTokens: 20,
        toolCalls: 1,
        subtasksStarted: 0,
      },
      followUpObjects: [{ id: "intent_1" }],
    });

    const snapshot = store.snapshot("run_audit");
    expect(snapshot?.audit).toMatchObject({
      stopReason: "completed",
      structuredOutput: { text: "结论" },
      usage: { toolCalls: 1 },
    });
    expect(JSON.stringify(snapshot?.audit)).not.toContain("reasoning");
    expect(snapshot?.events.map((event) => event.type)).toContain(
      "run.audit.recorded",
    );
  });
});
