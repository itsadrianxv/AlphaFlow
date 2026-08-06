import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  resolvePreviewSample,
  ScheduledTaskScoringLifecycleService,
  scoringPreviewFingerprint,
  summarizePreviewGate,
} from "~/server/application/scheduled-task/scheduled-task-scoring-lifecycle-service";

describe("确定性评分预览样本", () => {
  it("指定股票未选择样本时默认取前五只", () => {
    expect(
      resolvePreviewSample(
        {
          type: "stocks",
          stockCodes: ["000001", "000002", "000003", "000004", "000005", "000006"],
        },
        undefined,
      ),
    ).toEqual(["000001", "000002", "000003", "000004", "000005"]);
  });

  it("全部 A 股要求用户明确选择一至二十只样本", () => {
    expect(() =>
      resolvePreviewSample({ type: "all_a_shares" }, undefined),
    ).toThrow("PREVIEW_SAMPLE_REQUIRED");
    expect(() =>
      resolvePreviewSample(
        { type: "all_a_shares" },
        Array.from({ length: 21 }, (_, index) => String(index).padStart(6, "0")),
      ),
    ).toThrow("PREVIEW_SAMPLE_LIMIT");
  });
});

describe("确定性评分预览启用门控", () => {
  it("全样本无法评估时阻止启用", () => {
    expect(
      summarizePreviewGate({
        minScore: 10,
        results: [
          { evaluationStatus: "NONE", score: 0, minimumPossibleScore: 0, maximumPossibleScore: 20 },
          { evaluationStatus: "NONE", score: 0, minimumPossibleScore: 0, maximumPossibleScore: 20 },
        ],
        warnings: [],
      }),
    ).toMatchObject({ canActivate: false, evaluatedCount: 0 });
  });

  it("部分无法评估允许带警告启用，阈值高于最高分只警告零入选", () => {
    expect(
      summarizePreviewGate({
        minScore: 30,
        results: [
          { evaluationStatus: "FULL", score: 20, minimumPossibleScore: 0, maximumPossibleScore: 20 },
          { evaluationStatus: "NONE", score: 0, minimumPossibleScore: 0, maximumPossibleScore: 20 },
        ],
        warnings: [],
      }),
    ).toEqual({
      canActivate: true,
      evaluatedCount: 1,
      sampleCount: 2,
      warnings: ["部分样本无法评估", "最低分高于样本最高分，预期零入选"],
    });
  });
});

describe("确定性评分预览执行", () => {
  it("规则、范围、复权、指标参数或调度发生变化时配置指纹变化", () => {
    const base = {
      executionPlan: {
        universe: { type: "stocks", stockCodes: ["000001"] },
        data: { adjustment: "qfq" },
        indicators: [{ type: "macd", params: { fast: 12 } }],
        rules: [{ id: "rule_1", scoreDelta: 10 }],
      },
      scheduleSpec: { type: "DAILY", time: "18:00" },
    };
    const fingerprint = scoringPreviewFingerprint(base);
    expect(
      scoringPreviewFingerprint({
        ...base,
        executionPlan: {
          ...base.executionPlan,
          data: { adjustment: "hfq" },
        },
      }),
    ).not.toBe(fingerprint);
    expect(
      scoringPreviewFingerprint({
        ...base,
        scheduleSpec: { ...base.scheduleSpec, time: "19:00" },
      }),
    ).not.toBe(fingerprint);
  });

  it("异步提交执行级样本覆盖并绑定当前草稿版本", async () => {
    const created: Array<Record<string, unknown>> = [];
    const db = {
      scheduledTaskExecution: {
        findUnique: async () => null,
        create: async (args: Record<string, unknown>) => {
          created.push(args);
          return { id: "preview-1", status: "PENDING" };
        },
        updateMany: async () => ({ count: 1 }),
        update: async () => ({}),
      },
      scheduledTask: {
        findFirst: async () => ({
          id: "task-1",
          currentVersion: 2,
          versions: [
            {
              id: "version-2",
              executionPlan: {
                type: "deterministic_scoring",
                universe: { type: "all_a_shares" },
              },
              scheduleSpec: { type: "DAILY", time: "18:00" },
            },
          ],
        }),
      },
    };
    const publish = vi.fn(async () => ({}));

    const result = await new ScheduledTaskScoringLifecycleService(
      db as never,
      publish,
    ).startPreview({
      userId: "user-1",
      taskId: "task-1",
      expectedVersion: 2,
      sampleStockCodes: ["600519", "000001"],
      idempotencyKey: "preview-request-1",
    });

    expect(result).toEqual({ previewId: "preview-1", status: "SUBMITTED" });
    expect(created[0]).toMatchObject({
      data: {
        taskVersionId: "version-2",
        trigger: "PREVIEW",
        deliveryRequested: false,
        executionPlanOverride: {
          universe: { type: "stocks", stockCodes: ["600519", "000001"] },
        },
        previewSourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(publish).toHaveBeenCalledWith("preview-1");
  });
});

describe("确定性评分构建器预览", () => {
  it("提供异步预览、结构化结果和当前版本启用入口", async () => {
    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../app/scheduled-tasks/builder/scoring-task-builder.tsx",
      ),
      "utf8",
    );
    for (const label of [
      "运行预览",
      "启用任务",
      "数据截止",
      "叶子条件状态",
      "全部 A 股预览样本",
    ])
      expect(source).toContain(label);
    expect(source).toContain("getScoringPreview.useQuery");
    expect(source).toContain("refetchInterval");
  });
});
