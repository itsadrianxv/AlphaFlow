import { describe, expect, it, vi } from "vitest";
import { AgentConversationService } from "~/server/application/agent-runtime/agent-conversation-service";

describe("AgentConversationService", () => {
  it("creates a conversation turn and starts a Pi workflow run with message ids", async () => {
    const createTurn = vi.fn().mockResolvedValue({
      conversation: { id: "conv_1" },
      userMessage: { id: "msg_user_1" },
      assistantMessage: { id: "msg_assistant_1" },
    });
    const bindAssistantRun = vi.fn();
    const markAssistantStreaming = vi.fn();
    const startPiAgentRun = vi.fn().mockResolvedValue({
      runId: "run_1",
      status: "PENDING",
      createdAt: new Date("2026-07-08T00:00:00.000Z"),
    });
    const service = new AgentConversationService(
      {
        createTurn,
        bindAssistantRun,
        markAssistantStreaming,
      } as never,
      { startPiAgentRun } as never,
    );

    const result = await service.sendMessage({
      userId: "user_1",
      conversationId: "conv_1",
      skillId: "alphaflow-research-assistant",
      prompt: "继续分析",
      title: "继续分析",
    });

    expect(startPiAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        skillId: "alphaflow-research-assistant",
        prompt: "继续分析",
        conversationId: "conv_1",
        userMessageId: "msg_user_1",
        assistantMessageId: "msg_assistant_1",
      }),
    );
    expect(bindAssistantRun).toHaveBeenCalledWith({
      messageId: "msg_assistant_1",
      runId: "run_1",
    });
    expect(markAssistantStreaming).toHaveBeenCalledWith("msg_assistant_1");
    expect(result).toMatchObject({
      conversationId: "conv_1",
      runId: "run_1",
      userMessageId: "msg_user_1",
      assistantMessageId: "msg_assistant_1",
    });
  });
});
