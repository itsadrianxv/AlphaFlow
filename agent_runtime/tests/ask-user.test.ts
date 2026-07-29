import type { AgentHarness } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
  isScheduledTaskFlowComplete,
  registerHarnessEventHandlers,
  type HarnessEventState,
} from "../src/pi-adapter";
import { AgentRuntimeRunStore } from "../src/run-store";
import { createInternalTools } from "../src/tool-policy";

describe("ask_user tool", () => {
  it("returns a terminating structured input request", async () => {
    const tool = createInternalTools({
      pythonGatewayClient: {} as never,
      webInternalClient: {} as never,
      runId: "run_1",
      userId: "user_1",
      maxToolCalls: 10,
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

  it("通过专用 hook 进入等待状态并立即中止当前回合", async () => {
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
    const store = new AgentRuntimeRunStore(60_000);
    const request = {
      runId: "run_waiting_hook",
      userId: "user_1",
      skillId: "scheduled-task-setup",
      prompt: "创建定时任务",
    };
    const state: HarnessEventState = {
      lastAssistantText: "",
      scheduledDraftBuilt: false,
    };
    store.createOrGet(request);
    store.markRunning(request.runId);
    registerHarnessEventHandlers({ harness, store, request, state });

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
    expect(store.snapshot(request.runId)?.status).toBe("waiting_for_input");
    expect(store.snapshot(request.runId)?.events.map((event) => event.type)).toContain(
      "run.waiting_for_input",
    );
  });

  it("不允许普通确认文本替代草稿或明确的不支持结果", () => {
    expect(
      isScheduledTaskFlowComplete({
        lastAssistantText: "请确认后我再继续",
        scheduledDraftBuilt: false,
      }),
    ).toBe(false);
    expect(
      isScheduledTaskFlowComplete({
        lastAssistantText: "草稿已生成",
        scheduledDraftBuilt: true,
      }),
    ).toBe(true);
  });
});
