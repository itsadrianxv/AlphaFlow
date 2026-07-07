import { describe, expect, it } from "vitest";
import { AgentRuntimeRunStore } from "../src/run-store";

describe("AgentRuntimeRunStore", () => {
  it("assigns increasing event sequences and replays after a sequence", () => {
    const store = new AgentRuntimeRunStore(60_000);
    store.createOrGet({
      runId: "run_1",
      skillId: "alphaflow-research-assistant",
      prompt: "测试任务",
    });
    store.appendEvent("run_1", "agent.message", { text: "hello" });

    const replayed: number[] = [];
    const unsubscribe = store.subscribe("run_1", 1, (event) => {
      replayed.push(event.sequence);
    });

    expect(replayed).toEqual([2]);
    unsubscribe?.();
  });
});
