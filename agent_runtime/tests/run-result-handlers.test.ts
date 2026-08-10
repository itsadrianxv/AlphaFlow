import { describe, expect, it, vi } from "vitest";
import {
  ImmediateResearchResultHandler,
  ScheduledTaskResultHandler,
  type CandidateSeedSink,
  type ScheduledTaskEventSink,
  type ScheduledTaskResultWriter,
} from "../src/run-result-handlers";
import type { AgentCompletedResult } from "../src/agent-runner";
import type { StartRunRequest } from "../src/types";

const request: StartRunRequest = {
  runKind: "immediate_research",
  interactionMode: "research",
  runId: "run-research",
  userId: "user-1",
  skillId: "research",
  skillIds: ["research"],
  prompt: "研究公告并给出目标价和买入计划",
};

const completed: AgentCompletedResult = {
  kind: "completed",
  output: {
    text: "事实与证据：公司发布公告。\n目标价 20 元，建议买入。\n主要风险：履约不及预期。",
  },
  evidenceGaps: [],
  audit: {
    boundary: {
      version: "agent-execution.v1",
      runId: request.runId,
      objective: "即时研究",
      input: {},
      skillIds: ["research"],
      interactionMode: "research",
      capabilities: ["internal_web_search"],
      capabilityConstraints: {},
      network: {
        allowPublicHttp: true,
        allowPrivateNetwork: false,
        allowCredentialedUrls: false,
        allowedSchemes: ["http", "https"],
      },
      maxConcurrentSubtasks: 1,
      model: { provider: "test", id: "test" },
      usage: {
        steps: 1,
        inputTokens: 100,
        outputTokens: 30,
        toolCalls: 1,
        durationMs: 10,
        peakConcurrentSubtasks: 0,
      },
    },
    skills: [{ id: "research" }],
    model: { provider: "test", id: "test" },
    toolSummaries: [
      {
        toolName: "internal_web_search",
        inputSummary: { query: "公司公告" },
        outputSummary: { preview: "公司发布履约公告" },
      },
    ],
    structuredOutput: {
      text: "事实与证据：公司发布公告。\n目标价 20 元，建议买入。",
    },
    stopReason: "completed",
    usage: {
      steps: 1,
      inputTokens: 100,
      outputTokens: 30,
      toolCalls: 1,
      durationMs: 10,
      peakConcurrentSubtasks: 0,
    },
    cost: { currency: "USD", micros: 0 },
    costWarningExceeded: false,
    durationMs: 10,
    followUpObjects: [],
  },
};

describe("即时研究结果处理", () => {
  it("在响应前执行本地 guard，并异步投递候选种子", async () => {
    const enqueue = vi.fn<CandidateSeedSink["enqueue"]>(async () => ({
      accepted: true,
      pendingRecovery: false,
    }));
    const handler = new ImmediateResearchResultHandler({ enqueue });

    const settled = await handler.handle(request, completed);

    expect(settled.finalOutput).toMatchObject({
      text: expect.stringContaining("已拒绝请求中的执行性投资部分"),
      researchOnly: {
        mode: "research_only",
        blockedExecutableRequest: true,
      },
    });
    expect(String(settled.finalOutput.text)).not.toContain("目标价 20 元");
    expect(settled.followUpObjects).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledOnce();
  });
});

describe("定时任务结果处理", () => {
  it("由调用方发布生命周期事件并持久化结构化结果", async () => {
    const persistScheduledTaskResult =
      vi.fn<ScheduledTaskResultWriter["persistScheduledTaskResult"]>(
        async () => ({}),
      );
    const publish = vi.fn<ScheduledTaskEventSink["publish"]>(async () => "1-0");
    const handler = new ScheduledTaskResultHandler(
      { persistScheduledTaskResult },
      { publish },
    );
    const scheduledRequest: StartRunRequest = {
      ...request,
      runKind: "scheduled_task",
      interactionMode: "scheduled_task_execution",
      scheduledTask: {
        executionId: "execution-1",
        taskId: "task-1",
        taskVersionId: "task-version-1",
        userId: request.userId,
        runId: request.runId,
        executionPlan: {},
        allowedCapabilities: [],
        scheduledAt: "2026-08-07T10:00:00.000Z",
      },
    };
    const scheduledResult: AgentCompletedResult = {
      ...completed,
      output: {
        text: JSON.stringify({
          title: "盘后简报",
          summary: "市场缩量",
          body: "正文",
          evidence: [],
          quality: { status: "OK", warnings: [] },
        }),
      },
    };

    await handler.started(scheduledRequest);
    const settled = await handler.handle(scheduledRequest, scheduledResult);

    expect(publish.mock.calls.map(([event]) => event.eventType)).toEqual([
      "execution.started",
      "execution.succeeded",
    ]);
    expect(persistScheduledTaskResult).toHaveBeenCalledWith("execution-1", {
      runId: request.runId,
      status: "SUCCEEDED",
      title: "盘后简报",
      summary: "市场缩量",
      body: "正文",
      evidence: [],
      quality: { status: "OK", warnings: [] },
    });
    expect(settled.finalOutput).toMatchObject({ title: "盘后简报" });
  });

  it("事件发布失败不阻断运行，结果落库失败形成明确结算失败", async () => {
    const persistScheduledTaskResult =
      vi.fn<ScheduledTaskResultWriter["persistScheduledTaskResult"]>()
        .mockRejectedValueOnce(new Error("web unavailable"))
        .mockResolvedValueOnce({});
    const publish = vi
      .fn<ScheduledTaskEventSink["publish"]>()
      .mockRejectedValueOnce(new Error("redis unavailable"))
      .mockResolvedValue("2-0");
    const handler = new ScheduledTaskResultHandler(
      { persistScheduledTaskResult },
      { publish },
    );
    const scheduledRequest: StartRunRequest = {
      ...request,
      runKind: "scheduled_task",
      interactionMode: "scheduled_task_execution",
      scheduledTask: {
        executionId: "execution-2",
        taskId: "task-2",
        taskVersionId: "task-version-2",
        userId: request.userId,
        runId: request.runId,
        executionPlan: {},
        allowedCapabilities: [],
        scheduledAt: "2026-08-07T10:00:00.000Z",
      },
    };

    await expect(handler.started(scheduledRequest)).resolves.toBeUndefined();
    const settled = await handler.handle(scheduledRequest, completed);

    expect(settled).toMatchObject({
      failure: {
        code: "SCHEDULED_TASK_SETTLEMENT_FAILED",
        message: "web unavailable",
      },
    });
    expect(persistScheduledTaskResult).toHaveBeenLastCalledWith("execution-2", {
      runId: request.runId,
      status: "FAILED",
      error: { message: "web unavailable" },
    });
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: "execution.failed" }),
    );
  });
});
