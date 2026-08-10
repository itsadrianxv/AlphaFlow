import { describe, expect, it } from "vitest";
import { AgentRunner, type AgentExecutionAdapter } from "../src/agent-runner";
import { RuntimeAgentExecutionFactory } from "../src/agent-capability-registry";
import { AgentRuntimeService } from "../src/agent-runtime-service";
import { AgentRuntimeRunStore } from "../src/run-store";
import {
  ImmediateResearchResultHandler,
  ScheduledTaskResultHandler,
} from "../src/run-result-handlers";
import { SkillRegistry } from "../src/skill-registry";
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
  toolTimeoutMs: 1000,
  modelProvider: "deepseek",
  modelId: "deepseek-chat",
  modelTimeoutMs: 30_000,
  modelMaxRetries: 0,
  redisUrl: "redis://localhost:6379",
  scheduledTaskEventStream: "events",
  scheduledTaskEventMaxLen: 100,
};

function executionFactory() {
  return new RuntimeAgentExecutionFactory({
    config,
    pythonGatewayClient: {} as never,
    webInternalClient: {} as never,
  });
}

describe("AgentRuntimeService", () => {
  it("非法策略请求会形成稳定失败状态", async () => {
    const store = new AgentRuntimeRunStore(config.runTtlMs);
    const service = new AgentRuntimeService({
      config,
      skillRegistry: await new SkillRegistry().load(),
      store,
      runner: new AgentRunner({
        execute: async () => {
          throw new Error("不应执行 Harness");
        },
      }),
      agentExecutionFactory: executionFactory(),
      immediateResultHandler: new ImmediateResearchResultHandler({
        enqueue: async () => ({ accepted: true, pendingRecovery: false }),
      }),
      scheduledResultHandler: new ScheduledTaskResultHandler(
        { persistScheduledTaskResult: async () => ({}) },
        { publish: async () => "1-0" },
      ),
    });
    const request = {
      runKind: "immediate_research" as const,
      interactionMode: "research" as const,
      runId: "run-invalid-policy",
      userId: "user-1",
      skillId: "alphaflow-research-assistant",
      prompt: "研究公司公告",
      policy: { unexpected: true } as never,
    };

    await expect(service.start(request)).resolves.toBeUndefined();
    expect(store.snapshot(request.runId)).toMatchObject({
      status: "failed",
      errorCode: "EXECUTION_POLICY_INVALID",
    });
  });

  it("冻结计划并将 Runner 完成结果结算到 run-store", async () => {
    const adapter: AgentExecutionAdapter = {
      execute: async ({ emit, plan }) => {
        expect(plan.runKind).toBe("immediate_research");
        expect(plan.execution.snapshot.interactionMode).toBe("research");
        expect(plan.execution.snapshot.capabilities).toContain("ask_user");
        emit({ type: "message.started" });
        emit({ type: "message.delta", delta: "研究" });
        emit({ type: "message.completed", text: "研究结论" });
        return {
          kind: "completed",
          text: "研究结论",
          usage: { inputTokens: 20, outputTokens: 5 },
          evidenceGaps: [],
        };
      },
    };
    const store = new AgentRuntimeRunStore(config.runTtlMs);
    const registry = await new SkillRegistry().load();
    const service = new AgentRuntimeService({
      config,
      skillRegistry: registry,
      store,
      runner: new AgentRunner(adapter),
      agentExecutionFactory: executionFactory(),
      immediateResultHandler: new ImmediateResearchResultHandler({
        enqueue: async () => ({ accepted: true, pendingRecovery: false }),
      }),
      scheduledResultHandler: new ScheduledTaskResultHandler(
        { persistScheduledTaskResult: async () => ({}) },
        { publish: async () => "1-0" },
      ),
    });
    const request = {
      runKind: "immediate_research" as const,
      interactionMode: "research" as const,
      runId: "run-service",
      userId: "user-1",
      skillId: "alphaflow-research-assistant",
      skillIds: ["alphaflow-research-assistant"],
      prompt: "研究公司公告",
    };
    store.createOrGet(request);

    await service.start(request);

    const snapshot = store.snapshot(request.runId);
    expect(snapshot).toMatchObject({
      status: "succeeded",
      finalOutput: { text: "研究结论" },
      audit: { stopReason: "completed" },
    });
    expect(snapshot?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.boundary.frozen",
        "agent.message.delta",
        "artifact.created",
        "run.audit.recorded",
        "run.succeeded",
      ]),
    );
  });

  it("等待输入后以同一 runId 和持久化 SessionSpec 恢复下一轮", async () => {
    let turn = 0;
    const adapter: AgentExecutionAdapter = {
      execute: async ({ plan }) => {
        expect(plan.session).toMatchObject({
          mode: "persistent",
          id: "conversation-1",
        });
        turn += 1;
        if (turn === 1) {
          return {
            kind: "waiting_for_input",
            inputRequest: { question: "需要分析哪家公司？" },
            usage: { inputTokens: 10, outputTokens: 2 },
            evidenceGaps: ["缺少公司"],
          };
        }
        return {
          kind: "completed",
          text: "已完成平安银行研究",
          usage: { inputTokens: 12, outputTokens: 4 },
          evidenceGaps: [],
        };
      },
    };
    const store = new AgentRuntimeRunStore(config.runTtlMs);
    const service = new AgentRuntimeService({
      config,
      skillRegistry: await new SkillRegistry().load(),
      store,
      runner: new AgentRunner(adapter),
      agentExecutionFactory: executionFactory(),
      immediateResultHandler: new ImmediateResearchResultHandler({
        enqueue: async () => ({ accepted: true, pendingRecovery: false }),
      }),
      scheduledResultHandler: new ScheduledTaskResultHandler(
        { persistScheduledTaskResult: async () => ({}) },
        { publish: async () => "1-0" },
      ),
    });
    const request = {
      runKind: "immediate_research" as const,
      interactionMode: "research" as const,
      runId: "run-resume",
      userId: "user-1",
      sessionId: "conversation-1",
      skillId: "alphaflow-research-assistant",
      skillIds: ["alphaflow-research-assistant"],
      prompt: "研究一家公司",
    };

    await service.start(request);
    expect(store.snapshot(request.runId)?.status).toBe("waiting_for_input");
    expect(
      store.resume(request.runId, {
        prompt: "平安银行",
        userMessageId: "user-message-2",
        assistantMessageId: "assistant-message-2",
      }).kind,
    ).toBe("resumed");
    await service.resume(request.runId);

    expect(store.snapshot(request.runId)).toMatchObject({
      status: "succeeded",
      finalOutput: { text: "已完成平安银行研究" },
    });
    expect(turn).toBe(2);
  });
});
