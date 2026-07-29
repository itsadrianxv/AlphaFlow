import { describe, expect, it } from "vitest";
import { resolveAgentMessageText } from "~/app/agent-runtime/message-display";

describe("resolveAgentMessageText", () => {
  it("uses persisted content after generation has completed", () => {
    expect(
      resolveAgentMessageText({
        persistedText: "完整的最终回复",
        status: "SUCCEEDED",
        liveText: "流式中的临时内容",
      }),
    ).toBe("完整的最终回复");
  });

  it("does not let an empty live buffer hide persisted content", () => {
    expect(
      resolveAgentMessageText({
        persistedText: "已经写入数据库的正文",
        status: "STREAMING",
        liveText: "",
      }),
    ).toBe("已经写入数据库的正文");
  });

  it("keeps the more complete text while a response is streaming", () => {
    expect(
      resolveAgentMessageText({
        persistedText: "较短正文",
        status: "STREAMING",
        liveText: "较长的实时正文",
      }),
    ).toBe("较长的实时正文");
  });
});
