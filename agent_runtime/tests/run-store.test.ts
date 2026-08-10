import { describe, expect, it } from "vitest";
import { AgentRuntimeRunStore } from "../src/run-store";

describe("AgentRuntimeRunStore", () => {
  it("assigns increasing event sequences and replays after a sequence", () => {
    const store = new AgentRuntimeRunStore(60_000);
    store.createOrGet({
      runKind: "immediate_research",
      interactionMode: "research",
      runId: "run_1",
      userId: "user_1",
      skillId: "alphaflow-research-assistant",
      skillIds: [
        "alphaflow-research-assistant",
        "market_sentiment_temperature_skill",
      ],
      prompt: "测试任务",
    });
    store.appendEvent("run_1", "agent.message", { text: "hello" });

    const replayed: number[] = [];
    const unsubscribe = store.subscribe("run_1", 1, (event) => {
      replayed.push(event.sequence);
    });

    expect(replayed).toEqual([2]);
    expect(store.snapshot("run_1")?.skillIds).toEqual([
      "alphaflow-research-assistant",
      "market_sentiment_temperature_skill",
    ]);
    expect(store.snapshot("run_1")?.input.skillIds).toEqual([
      "alphaflow-research-assistant",
      "market_sentiment_temperature_skill",
    ]);
    unsubscribe?.();
  });

  it("enters waiting state and resumes the same run idempotently", () => {
    const store = new AgentRuntimeRunStore(60_000);
    store.createOrGet({
      runKind: "immediate_research",
      interactionMode: "research",
      runId: "run_waiting",
      userId: "user_1",
      skillId: "skill_1",
      prompt: "需要澄清",
    });
    store.markRunning("run_waiting");
    store.markWaitingForInput("run_waiting", {
      question: "请选择市场",
      options: [{ label: "A 股", value: "A" }],
    });

    expect(store.snapshot("run_waiting")?.status).toBe("waiting_for_input");
    expect(store.snapshot("run_waiting")?.events.map((event) => event.type)).toEqual([
      "run.created",
      "run.started",
      "user.input.requested",
      "run.waiting_for_input",
    ]);

    const firstResume = store.resume("run_waiting", {
      prompt: "A 股",
      userMessageId: "user_message_2",
      assistantMessageId: "assistant_message_2",
    });
    const secondResume = store.resume("run_waiting", {
      prompt: "港股",
      userMessageId: "user_message_3",
      assistantMessageId: "assistant_message_3",
    });

    expect(firstResume.kind).toBe("resumed");
    expect(secondResume.kind).toBe("already_running");
    expect(store.snapshot("run_waiting")?.input.prompt).toBe("A 股");
  });

  it("cancels a running run immediately and ignores late success", () => {
    const store = new AgentRuntimeRunStore(60_000);
    store.createOrGet({
      runKind: "immediate_research",
      interactionMode: "research",
      runId: "run_cancel",
      userId: "user_1",
      skillId: "skill_1",
      prompt: "长任务",
    });
    store.markRunning("run_cancel");

    expect(store.abort("run_cancel")).toBe(true);
    expect(store.snapshot("run_cancel")?.status).toBe("cancelled");

    store.markSucceeded("run_cancel", { text: "迟到结果" });
    expect(store.snapshot("run_cancel")?.status).toBe("cancelled");
    expect(
      store.snapshot("run_cancel")?.events.some((event) => event.type === "run.succeeded"),
    ).toBe(false);
  });
});
