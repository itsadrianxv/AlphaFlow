import type { AgentHarness } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  isScheduledTaskFlowComplete,
  mapPiHarnessEvent,
  registerPiHarnessEventHandlers,
  resolveScheduledTaskFlowFailure,
  type PiHarnessEventState,
} from "../src/pi-harness-events";
import type { RunnerEvent } from "../src/agent-runner";
import { createInternalTools } from "../src/tool-policy";

describe("ask_user tool", () => {
  it("returns a terminating structured input request", async () => {
    const tool = createInternalTools({
      pythonGatewayClient: {} as never,
      webInternalClient: {} as never,
      runId: "run_1",
      userId: "user_1",
      toolTimeoutMs: 1000,
    }).find((item) => item.name === "ask_user");

    const result = await tool?.execute(
      "call_1",
      {
        question: "请选择研究市场",
        options: [{ label: "A 股", value: "A" }],
      },
      undefined,
    );

    expect(result?.terminate).toBe(true);
    expect(result?.details).toEqual({
      question: "请选择研究市场",
      options: [{ label: "A 股", value: "A" }],
    });
  });

  it("通过专用 hook 返回等待请求并立即中止当前回合", async () => {
    const handlers = new Map<string, (event: never) => unknown>();
    const abort = vi.fn(async () => undefined);
    const harness = {
      subscribe: vi.fn((handler) => {
        handlers.set("*", handler);
        return () => undefined;
      }),
      on: vi.fn((type, handler) => {
        handlers.set(type, handler);
        return () => undefined;
      }),
      abort,
    } as unknown as AgentHarness;
    const state: PiHarnessEventState = {
      lastAssistantText: "",
      scheduledDraftBuilt: false,
      toolSummaries: [],
    };
    const events: RunnerEvent[] = [];
    registerPiHarnessEventHandlers({
      harness,
      emit: (event) => events.push(event),
      state,
    });

    const patch = await handlers.get("tool_result")?.({
      type: "tool_result",
      toolCallId: "call_1",
      toolName: "ask_user",
      input: {},
      content: [{ type: "text", text: "请选择投递目标" }],
      details: {
        question: "请选择投递目标",
        options: [{ label: "仅保存", value: "SAVE_ONLY" }],
      },
      isError: false,
    } as never);

    expect(patch).toEqual({ terminate: true });
    expect(abort).toHaveBeenCalledOnce();
    expect(state.waitingForInput).toEqual({
      question: "请选择投递目标",
      options: [{ label: "仅保存", value: "SAVE_ONLY" }],
    });
    expect(events.map((event) => event.type)).toContain("tool.completed");
  });

  it("不允许普通确认文本替代草稿或明确的不支持结果", () => {
    expect(
      isScheduledTaskFlowComplete({
        lastAssistantText: "请确认后我再继续",
        scheduledDraftBuilt: false,
        toolSummaries: [],
      }),
    ).toBe(false);
    expect(
      isScheduledTaskFlowComplete({
        lastAssistantText: "草稿已生成",
        scheduledDraftBuilt: true,
        toolSummaries: [],
      }),
    ).toBe(true);
  });

  it("确定性工具错误会形成稳定的可见失败终态", () => {
    const state: PiHarnessEventState = {
      lastAssistantText: "",
      scheduledDraftBuilt: false,
      toolSummaries: [],
    };

    mapPiHarnessEvent(
      {
        type: "tool_result",
        toolCallId: "call_task_edit",
        toolName: "build_scheduled_task_edit_draft",
        input: {},
        content: [{ type: "text", text: "TASK_NOT_EDITABLE" }],
        details: { errorCode: "TASK_NOT_EDITABLE" },
        isError: true,
      } as never,
      state,
      () => undefined,
    );

    expect(resolveScheduledTaskFlowFailure(state)).toMatchObject({
      errorCode: "SCHEDULED_TASK_TOOL_FAILED",
      errorMessage: expect.stringContaining("TASK_NOT_EDITABLE"),
    });
  });

  it("delta 事件只携带增量，不重复携带累计全文", () => {
    const state: PiHarnessEventState = {
      lastAssistantText: "",
      scheduledDraftBuilt: false,
      toolSummaries: [],
    };
    const events: RunnerEvent[] = [];
    const emit = (event: RunnerEvent) => events.push(event);

    mapPiHarnessEvent(
      {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "你好" }],
        },
      } as never,
      state,
      emit,
    );
    mapPiHarnessEvent(
      {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "你好世界" }],
        },
      } as never,
      state,
      emit,
    );
    mapPiHarnessEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "你好世界" }],
        },
      } as never,
      state,
      emit,
    );

    const deltas = events.filter((event) => event.type === "message.delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toEqual({ type: "message.delta", delta: "你好" });
    expect(deltas[1]).toEqual({ type: "message.delta", delta: "世界" });
    expect(events.filter((event) => event.type === "message.completed")).toEqual([
      { type: "message.completed", text: "你好世界" },
    ]);
  });
});
