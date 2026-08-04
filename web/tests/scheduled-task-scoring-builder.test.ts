import { describe, expect, it } from "vitest";
import { ScheduledTaskDraftController } from "~/server/application/scheduled-task/scheduled-task-draft-controller";
import { ScheduledTaskScoringDraftService } from "~/server/application/scheduled-task/scheduled-task-scoring-draft-service";
import { isScoringDraftReadyForAutosave } from "~/app/scheduled-tasks/builder/scoring-task-autosave";

const baseDraft = {
  name: "多周期评分",
  schedule: {
    type: "TRADING_DAY" as const,
    time: "18:00",
    timezone: "Asia/Shanghai",
    marketCalendar: "SSE",
  },
  universe: {
    type: "stocks" as const,
    stockInputs: ["贵州茅台 600519.SH", "000001.SZ", "600519"],
  },
  data: { adjustment: "qfq" as const },
  indicatorParams: {
    macd: { fast: 12, slow: 26, signal: 9 },
    kdj: { period: 9, kSmoothing: 3, dSmoothing: 3 },
  },
  rules: [
    {
      id: "macd_positive",
      name: "日线 MACD 为正",
      points: 15,
      condition: {
        timeframe: "daily" as const,
        metric: "macd.histogram",
        operator: "gt" as const,
        value: 0,
      },
    },
  ],
  selection: { minScore: 10, limit: 100 },
  output: { type: "SCORING_REPORT" as const, feishuSummaryLimit: 20, sendOnEmpty: true },
  delivery: { type: "SAVE_ONLY" as const },
};

describe("确定性评分草稿 Controller", () => {
  it("规范化股票代码、去重并从条件生成指标声明", () => {
    const result = new ScheduledTaskDraftController().validate(baseDraft);

    expect(result).toMatchObject({ valid: true });
    expect(result.valid && result.draft.executionPlan).toMatchObject({
      universe: { type: "stocks", stockCodes: ["600519", "000001"] },
      indicators: [
        {
          id: "macd",
          type: "macd",
          timeframes: ["daily"],
          params: { fast: 12, slow: 26, signal: 9 },
        },
      ],
    });
  });

  it("把操作符和值类型错误定位到规则条件", () => {
    const result = new ScheduledTaskDraftController().validate({
      ...baseDraft,
      rules: [
        {
          ...baseDraft.rules[0],
          condition: {
            timeframe: "daily",
            metric: "candle.direction",
            operator: "gt",
            value: 1,
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "rules.0.condition.operator" }),
        expect.objectContaining({ path: "rules.0.condition.value" }),
      ]),
    );
  });

  it("限制条件树深度和节点数量并定位到规则", () => {
    let condition: unknown = {
      timeframe: "daily",
      metric: "close",
      operator: "gt",
      value: 1,
    };
    for (let index = 0; index < 9; index += 1) condition = { not: condition };

    const result = new ScheduledTaskDraftController().validate({
      ...baseDraft,
      rules: [{ ...baseDraft.rules[0], condition }],
    });

    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringMatching(/^rules\.0\.condition/),
        }),
      ]),
    );
  });

  it("结构化 Agent 变更集与页面草稿共用指标语义校验", () => {
    const built = new ScheduledTaskDraftController().validate(baseDraft);
    expect(built.valid).toBe(true);
    if (!built.valid) return;

    const result = new ScheduledTaskDraftController().validateExecutionPlan({
      ...built.draft.executionPlan,
      indicators: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "indicators",
      message: "MACD 缺少 daily 周期声明",
    });
  });
});

describe("确定性评分草稿保存", () => {
  it("未填写任务名或规则名时不触发自动保存", () => {
    expect(isScoringDraftReadyForAutosave(baseDraft)).toBe(true);

    expect(
      isScoringDraftReadyForAutosave({
        name: "",
        rules: [{ name: "" }],
        universe: { type: "all_a_shares" },
        delivery: { type: "SAVE_ONLY" },
      }),
    ).toBe(false);

    expect(
      isScoringDraftReadyForAutosave({
        name: "多周期评分",
        rules: [{ name: "" }],
        universe: { type: "all_a_shares" },
        delivery: { type: "SAVE_ONLY" },
      }),
    ).toBe(false);

    expect(
      isScoringDraftReadyForAutosave({
        name: "多周期评分",
        rules: [{ name: "日线 MACD 为正" }],
        universe: { type: "all_a_shares" },
        delivery: { type: "SAVE_ONLY" },
      }),
    ).toBe(true);
  });

  it("只保存草稿和结构化版本，不创建执行或投递", async () => {
    const created: Record<string, unknown>[] = [];
    const db = {
      scheduledTaskVersion: { findUnique: async () => null },
      scheduledTask: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "draft_1", currentVersion: 1 };
        },
      },
    };

    const result = await new ScheduledTaskScoringDraftService(db as never).save({
      userId: "user_1",
      idempotencyKey: "save-draft-1",
      value: baseDraft,
    });

    expect(result).toEqual({ taskId: "draft_1", version: 1, saved: true });
    expect(created[0]).toMatchObject({
      userId: "user_1",
      name: "多周期评分",
      status: "DRAFT",
      nextRunAt: null,
      versions: {
        create: expect.objectContaining({
          userPrompt: "",
          dataSources: [],
          executionPlan: expect.objectContaining({ type: "deterministic_scoring" }),
        }),
      },
    });
    expect(db).not.toHaveProperty("scheduledTaskExecution");
    expect(db).not.toHaveProperty("scheduledTaskDelivery");
  });

  it("基于期望版本编辑草稿并追加结构化版本", async () => {
    const versions: Record<string, unknown>[] = [];
    const db = {
      scheduledTaskVersion: { findUnique: async () => null },
      $transaction: async (
        run: (tx: Record<string, unknown>) => Promise<unknown>,
      ) =>
        run({
          scheduledTask: { updateMany: async () => ({ count: 1 }) },
          scheduledTaskVersion: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              versions.push(data);
              return data;
            },
          },
        }),
    };

    const result = await new ScheduledTaskScoringDraftService(db as never).save({
      userId: "user_1",
      taskId: "draft_1",
      expectedVersion: 2,
      idempotencyKey: "save-draft-2",
      value: { ...baseDraft, name: "多周期评分 v2" },
    });

    expect(result).toEqual({ taskId: "draft_1", version: 3, saved: true });
    expect(versions).toEqual([
      expect.objectContaining({
        taskId: "draft_1",
        version: 3,
        executionPlan: expect.objectContaining({ type: "deterministic_scoring" }),
      }),
    ]);
  });
});
