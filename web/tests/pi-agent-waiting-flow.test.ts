import { describe, expect, it, vi } from "vitest";
import { PiAgentRuntimeLangGraph } from "~/server/infrastructure/workflow/langgraph/pi-agent-runtime-graph";

describe("Pi agent 等待用户输入链路", () => {
  it("收到 run.waiting_for_input 后立即暂停工作流", async () => {
    const markAssistantWaitingByRun = vi.fn(async () => undefined);
    const appendAssistantDeltas = vi.fn(async () => undefined);
    const graph = new PiAgentRuntimeLangGraph({
      agentRuntimeClient: {
        startRun: vi.fn(async () => ({ status: "running" })),
        streamRunEvents: async function* () {
          yield {
            runId: "run-1",
            sequence: 1,
            type: "agent.message.delta",
            timestamp: new Date().toISOString(),
            payload: { delta: "请先选择" },
          };
          yield {
            runId: "run-1",
            sequence: 2,
            type: "user.input.requested",
            timestamp: new Date().toISOString(),
            payload: { question: "请选择市场" },
          };
          yield {
            runId: "run-1",
            sequence: 3,
            type: "run.waiting_for_input",
            timestamp: new Date().toISOString(),
            payload: { question: "请选择市场" },
          };
        },
      } as never,
      agentRuntimeRepository: {
        recordRuntimeEvent: vi.fn(async () => undefined),
      } as never,
      agentConversationRepository: {
        getSeedMessages: vi.fn(async () => []),
        appendAssistantDeltas,
        markAssistantWaitingByRun,
      } as never,
    });
    const state = graph.buildInitialState({
      runId: "run-1",
      userId: "user-1",
      query: "创建定时任务",
      progressPercent: 0,
      input: {
        skillId: "scheduled-task-setup",
        skillIds: ["scheduled-task-setup"],
        prompt: "创建定时任务",
        conversationId: "conversation-1",
        userMessageId: "user-message-1",
        assistantMessageId: "assistant-message-1",
      },
    });
    state.preparedTask = {
      skillId: "scheduled-task-setup",
      skillIds: ["scheduled-task-setup"],
      prompt: "创建定时任务",
      title: "创建定时任务",
      conversationId: "conversation-1",
      userMessageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
    };

    await expect(
      graph.execute({ initialState: state, startNodeIndex: 1 }),
    ).rejects.toMatchObject({
      reason: "user_input_required",
    });
    expect(markAssistantWaitingByRun).toHaveBeenCalledWith("run-1", {
      question: "请选择市场",
    });
    expect(appendAssistantDeltas).toHaveBeenCalledWith("assistant-message-1", [
      "请先选择",
    ]);
  });

  it("大量 delta 按批次持久化且不生成逐条进度事件", async () => {
    const appendAssistantDeltas = vi.fn<
      (messageId: string, deltas: string[]) => Promise<void>
    >(async () => undefined);
    const onNodeProgress = vi.fn<
      (nodeKey: string, payload: Record<string, unknown>) => Promise<void>
    >(async () => undefined);
    const graph = new PiAgentRuntimeLangGraph({
      agentRuntimeClient: {
        startRun: vi.fn(async () => ({ status: "running" })),
        getRun: vi.fn(async () => ({
          id: "run-1",
          status: "succeeded",
          skillId: "skill",
          title: "title",
          input: { prompt: "prompt" },
          events: [],
          finalOutput: { text: "x" },
          createdAt: new Date().toISOString(),
        })),
        streamRunEvents: async function* () {
          yield {
            runId: "run-1",
            sequence: 1,
            type: "agent.message.start",
            timestamp: new Date().toISOString(),
          };
          for (let sequence = 2; sequence < 5002; sequence += 1) {
            yield {
              runId: "run-1",
              sequence,
              type: "agent.message.delta",
              timestamp: new Date().toISOString(),
              payload: { delta: "a" },
            };
          }
          yield {
            runId: "run-1",
            sequence: 5002,
            type: "run.succeeded",
            timestamp: new Date().toISOString(),
          };
        },
      } as never,
      agentRuntimeRepository: {
        recordRuntimeEvent: vi.fn(async () => undefined),
        listArtifacts: vi.fn(async () => []),
      } as never,
      agentConversationRepository: {
        getSeedMessages: vi.fn(async () => []),
        markAssistantStreaming: vi.fn(async () => undefined),
        appendAssistantDeltas,
        markAssistantSucceeded: vi.fn(async () => undefined),
      } as never,
    });
    const state = graph.buildInitialState({
      runId: "run-1",
      userId: "user-1",
      query: "q",
      progressPercent: 0,
      input: {
        skillId: "skill",
        skillIds: ["skill"],
        prompt: "prompt",
        conversationId: "c",
        assistantMessageId: "m",
      },
    });
    state.preparedTask = {
      skillId: "skill",
      skillIds: ["skill"],
      prompt: "prompt",
      title: "title",
      conversationId: "c",
      assistantMessageId: "m",
    };

    await graph.execute({
      initialState: state,
      startNodeIndex: 1,
      hooks: { onNodeProgress },
    });

    expect(appendAssistantDeltas.mock.calls.length).toBe(2);
    expect(appendAssistantDeltas.mock.calls.flatMap((call) => call[1]).join(""))
      .toHaveLength(5000);
    expect(
      onNodeProgress.mock.calls.filter(
        (call) => call[1].piEventType === "agent.message.delta",
      ),
    ).toHaveLength(0);
  });

  it("事件流异常时仍会持久化尚未达到阈值的 delta", async () => {
    const appendAssistantDeltas = vi.fn(async () => undefined);
    const graph = new PiAgentRuntimeLangGraph({
      agentRuntimeClient: {
        startRun: vi.fn(async () => ({ status: "running" })),
        streamRunEvents: async function* () {
          yield {
            runId: "run-1",
            sequence: 1,
            type: "agent.message.delta",
            timestamp: new Date().toISOString(),
            payload: { delta: "未完成文本" },
          };
          throw new Error("流中断");
        },
      } as never,
      agentRuntimeRepository: {
        recordRuntimeEvent: vi.fn(async () => undefined),
      } as never,
      agentConversationRepository: {
        getSeedMessages: vi.fn(async () => []),
        appendAssistantDeltas,
      } as never,
    });
    const state = graph.buildInitialState({
      runId: "run-1",
      userId: "user-1",
      query: "q",
      progressPercent: 0,
      input: {
        skillId: "skill",
        skillIds: ["skill"],
        prompt: "prompt",
        assistantMessageId: "m",
      },
    });
    state.preparedTask = {
      skillId: "skill",
      skillIds: ["skill"],
      prompt: "prompt",
      title: "title",
      assistantMessageId: "m",
    };

    await expect(
      graph.execute({ initialState: state, startNodeIndex: 1 }),
    ).rejects.toThrow("流中断");
    expect(appendAssistantDeltas).toHaveBeenCalledWith("m", ["未完成文本"]);
  });
});
