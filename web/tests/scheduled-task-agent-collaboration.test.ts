import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScheduledTaskAgentChangeController } from "~/server/application/scheduled-task/scheduled-task-agent-change-controller";

const draft = {
  name: "价值评分",
  schedule: { type: "DAILY", time: "18:00", timezone: "Asia/Shanghai" },
  universe: { type: "stocks", stockInputs: ["600519"] },
  data: { adjustment: "qfq" },
  indicatorParams: {
    macd: { fast: 12, slow: 26, signal: 9 },
    kdj: { period: 9, kSmoothing: 3, dSmoothing: 3 },
  },
  rules: [
    {
      id: "quality",
      name: "质量",
      scoreDelta: 10,
      condition: { ">": [{ var: "daily.close.current" }, 10] },
    },
  ],
  selection: { minScore: 10, limit: 100 },
  output: { type: "SCORING_REPORT", feishuSummaryLimit: 20, sendOnEmpty: true },
  delivery: { type: "SAVE_ONLY" },
};

const changeSet = {
  schemaVersion: "scoring-task-agent-changes.v2",
  generatedAtVersion: 3,
  ambiguity: { status: "CLEAR" },
  operations: [
    {
      type: "ADD_RULE",
      rule: {
        id: "momentum",
        name: "动量",
        scoreDelta: 5,
        condition: { ">": [{ var: "daily.macd.histogram.current" }, 0] },
      },
    },
    { type: "REMOVE_RULE", ruleId: "quality" },
    { type: "SET_SELECTION", selection: { minScore: 5, limit: 50 } },
  ],
};

describe("评分规则构建器 Agent 变更集", () => {
  it("整套应用新增、移除和筛选变更并返回可见标记", () => {
    const result = new ScheduledTaskAgentChangeController().apply({
      generatedDraft: draft,
      currentDraft: draft,
      currentVersion: 3,
      changeSet,
    });

    expect(result).toMatchObject({
      status: "APPLIED",
      draft: {
        rules: [{ id: "momentum", name: "动量", scoreDelta: 5 }],
        selection: { minScore: 5, limit: 50 },
      },
      markers: [
        { type: "ADDED", ruleId: "momentum" },
        { type: "REMOVED", ruleId: "quality" },
        { type: "MODIFIED", field: "selection" },
      ],
    });
  });

  it("影响评分或调度的歧义只返回聚焦问题", () => {
    const result = new ScheduledTaskAgentChangeController().apply({
      generatedDraft: draft,
      currentDraft: draft,
      currentVersion: 3,
      changeSet: {
        ...changeSet,
        ambiguity: {
          status: "NEEDS_CLARIFICATION",
          question: "最低分应当设为 5 分还是 10 分？",
        },
      },
    });

    expect(result).toEqual({
      status: "NEEDS_CLARIFICATION",
      question: "最低分应当设为 5 分还是 10 分？",
    });
  });

  it("当前草稿变化后不自动合并，只允许覆盖或丢弃", () => {
    const controller = new ScheduledTaskAgentChangeController();
    expect(
      controller.apply({
        generatedDraft: draft,
        currentDraft: { ...draft, name: "用户刚修改的名称" },
        currentVersion: 4,
        changeSet,
      }),
    ).toEqual({
      status: "VERSION_CONFLICT",
      generatedAtVersion: 3,
      currentVersion: 4,
      choices: ["OVERWRITE_DRAFT", "DISCARD_AGENT_CHANGES"],
    });

    expect(
      controller.apply({
        generatedDraft: draft,
        currentDraft: { ...draft, name: "用户刚修改的名称" },
        currentVersion: 4,
        changeSet,
        conflictChoice: "DISCARD_AGENT_CHANGES",
      }),
    ).toEqual({ status: "DISCARDED" });
  });

  it("变更契约没有投递或 Webhook 操作", () => {
    const result = new ScheduledTaskAgentChangeController().apply({
      generatedDraft: draft,
      currentDraft: draft,
      currentVersion: 3,
      changeSet: {
        ...changeSet,
        operations: [
          { type: "SET_DELIVERY", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/secret" },
        ],
      },
    });
    expect(result.status).toBe("REJECTED");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("构建器提供独立会话回看、整套应用和显式冲突选择", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../app/scheduled-tasks/builder/scoring-task-builder.tsx",
      ),
      "utf8",
    );
    for (const label of [
      "Agent 辅助",
      "整套应用",
      "覆盖草稿",
      "丢弃 Agent 变更",
      "回看完整 Agent 会话与审计",
      "Agent 新增",
      "Agent 修改",
    ])
      expect(source).toContain(label);
  });

  it("构建器下拉框文案完整显示且桌面 Agent 栏固定在右侧视口", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../app/scheduled-tasks/builder/scoring-task-builder.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("h-10 w-full");
    expect(source).toContain("!py-0");
    expect(source).toContain("lg:fixed lg:top-0 lg:right-0");
    expect(source).toContain("lg:pr-[360px]");
    expect(source).toContain("lg:h-screen");
    expect(source).toContain("lg:overflow-hidden");
  });

  it("Agent 辅助复用投研智能体消息布局并把输入区固定在底部", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../app/scheduled-tasks/builder/scoring-task-builder.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("app-scroll min-h-0 flex-1 overflow-y-auto");
    expect(source).toContain("flex justify-end");
    expect(source).toContain("flex justify-start");
    expect(source).toContain("shrink-0 border-t");
    expect(source).toContain("h-[93px]");
    expect(source).toContain('aria-label="发送消息"');
  });

  it("Agent 辅助默认收起分析过程章节", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../app/scheduled-tasks/builder/scoring-task-builder.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("splitAgentReasoningSection");
    expect(source).toContain("<details");
    expect(source).toContain("分析过程");
    expect(source).toContain("reasoningContent");
  });

  it("评分构建器 Agent 技能不接收或修改投递凭证", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../agent_runtime/skills/scheduled-task-edit/SKILL.md",
      ),
      "utf8",
    );
    expect(source).toContain("scoring-task-agent-changes.v2");
    expect(source).toContain("不得询问、读取、输出或修改 Webhook");
    expect(source).not.toContain("SET_DELIVERY");
  });
});
