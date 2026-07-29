import { describe, expect, it, vi } from "vitest";
import { PiAgentRuntimeLangGraph } from "~/server/infrastructure/workflow/langgraph/pi-agent-runtime-graph";

describe("Pi agent 等待用户输入链路", () => {
  it("收到 run.waiting_for_input 后立即暂停工作流", async () => {
    const markAssistantWaitingByRun = vi.fn(async () => undefined);
    const graph = new PiAgentRuntimeLangGraph({
      agentRuntimeClient: {
        startRun: vi.fn(async () => ({ status: "running" })),
        streamRunEvents: async function* () {
          yield {
            runId: "run-1",
            sequence: 1,
            type: "user.input.requested",
            timestamp: new Date().toISOString(),
            payload: { question: "请选择市场" },
          };
          yield {
            runId: "run-1",
            sequence: 2,
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
  });
});
