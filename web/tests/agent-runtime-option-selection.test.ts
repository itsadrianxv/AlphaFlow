import { describe, expect, it } from "vitest";
import { formatAgentInputOptionPrompt } from "~/app/agent-runtime/agent-input-option";

describe("Agent Runtime 用户选项提交", () => {
  it("同时向 Agent 传递用户可读标签与稳定机器值", () => {
    expect(
      formatAgentInputOptionPrompt({
        label: "按现有行情条件临时构造",
        value: "temp_proxy",
      }),
    ).toBe("用户选择：按现有行情条件临时构造（value: temp_proxy）");
  });
});
