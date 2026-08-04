import { describe, expect, it } from "vitest";
import {
  resolveAgentMessageText,
  splitAgentReasoningSection,
} from "~/app/agent-runtime/message-display";

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

describe("splitAgentReasoningSection", () => {
  it("keeps content unchanged when no reasoning heading exists", () => {
    const content = "## 结论\n可以关注。\n\n## 风险\n波动较大。";

    expect(splitAgentReasoningSection(content)).toEqual({
      mainContent: content,
      reasoningContent: "",
    });
  });

  it("extracts the first analysis process section", () => {
    expect(
      splitAgentReasoningSection(
        "## 结论\n可以关注。\n\n## 分析过程\n1. 先看盈利。\n2. 再看估值。",
      ),
    ).toEqual({
      mainContent: "## 结论\n可以关注。",
      reasoningContent: "1. 先看盈利。\n2. 再看估值。",
    });
  });

  it("recognizes reasoning aliases and third-level headings", () => {
    expect(
      splitAgentReasoningSection(
        "结论先行。\n\n### reasoning\nCheck revenue.\nCheck cash flow.",
      ),
    ).toEqual({
      mainContent: "结论先行。",
      reasoningContent: "Check revenue.\nCheck cash flow.",
    });

    expect(
      splitAgentReasoningSection("## 推理依据：\n- 估值分位较低"),
    ).toEqual({
      mainContent: "",
      reasoningContent: "- 估值分位较低",
    });
  });

  it("stops extraction at the next same-or-higher heading", () => {
    expect(
      splitAgentReasoningSection(
        "## 结论\n可以关注。\n\n## 分析过程\n- 数据筛选\n\n### 子项\n- 细节\n\n## 风险\n需求回落。",
      ),
    ).toEqual({
      mainContent: "## 结论\n可以关注。\n\n## 风险\n需求回落。",
      reasoningContent: "- 数据筛选\n\n### 子项\n- 细节",
    });
  });

  it("handles partial streaming content without throwing", () => {
    expect(() =>
      splitAgentReasoningSection("## 结论\n处理中\n\n## 分析过程\n- "),
    ).not.toThrow();
    expect(
      splitAgentReasoningSection("## 结论\n处理中\n\n## 分析过程\n- "),
    ).toEqual({
      mainContent: "## 结论\n处理中",
      reasoningContent: "-",
    });
  });

  it("preserves evidence tokens in each split section", () => {
    expect(
      splitAgentReasoningSection(
        "## 结论\n改善明显 [[evidence:item-1]]\n\n## 分析过程\n数据交叉验证 [[evidence:item-2]]",
      ),
    ).toEqual({
      mainContent: "## 结论\n改善明显 [[evidence:item-1]]",
      reasoningContent: "数据交叉验证 [[evidence:item-2]]",
    });
  });
});
