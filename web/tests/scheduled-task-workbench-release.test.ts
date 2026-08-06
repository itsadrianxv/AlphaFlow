import { describe, expect, it } from "vitest";
import { ScheduledTaskDraftController } from "~/server/application/scheduled-task/scheduled-task-draft-controller";
import { ScheduledTaskScoringDraftService } from "~/server/application/scheduled-task/scheduled-task-scoring-draft-service";
import {
  evaluateScheduledTaskRelease,
  SCHEDULED_TASK_WORKBENCH_SECTIONS,
} from "~/server/domain/scheduled-task/workbench-release-gate";

describe("定时评分工作台契约", () => {
  it("为单页工作流提供稳定且完整的分区导航", () => {
    expect(SCHEDULED_TASK_WORKBENCH_SECTIONS).toEqual([
      { id: "task", label: "任务" },
      { id: "schedule", label: "调度" },
      { id: "universe", label: "范围" },
      { id: "rules", label: "规则" },
      { id: "selection", label: "筛选" },
      { id: "delivery", label: "投递" },
      { id: "preview", label: "预览" },
    ]);
  });
});

describe("定时评分发布门禁", () => {
  it("固定请求样本的本地编辑、语义校验和保存 P95 达标", async () => {
    const sample = {
      name: "固定性能样本",
      schedule: {
        type: "TRADING_DAY" as const,
        time: "18:00",
        timezone: "Asia/Shanghai",
        marketCalendar: "SSE",
      },
      universe: { type: "stocks" as const, stockInputs: ["600519", "000001"] },
      data: { adjustment: "qfq" as const },
      indicatorParams: {
        macd: { fast: 12, slow: 26, signal: 9 },
        kdj: { period: 9, kSmoothing: 3, dSmoothing: 3 },
      },
      rules: [
        {
          id: "momentum",
          name: "MACD 动量",
          scoreDelta: 10,
          condition: { ">": [{ var: "daily.macd.histogram.current" }, 0] },
        },
      ],
      selection: { minScore: 10, limit: 50 },
      output: {
        type: "SCORING_REPORT" as const,
        feishuSummaryLimit: 20,
        sendOnEmpty: true,
      },
      delivery: { type: "SAVE_ONLY" as const },
    };
    const measure = async (run: () => unknown | Promise<unknown>) => {
      const startedAt = performance.now();
      await run();
      return performance.now() - startedAt;
    };
    const localEdit: number[] = [];
    const semanticValidation: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      localEdit.push(
        await measure(() => ({
          ...sample,
          selection: { ...sample.selection, minScore: 10 + (index % 2) },
        })),
      );
      semanticValidation.push(
        await measure(() => new ScheduledTaskDraftController().validate(sample)),
      );
    }
    const service = new ScheduledTaskScoringDraftService({
      scheduledTaskVersion: { findUnique: async () => null },
      scheduledTask: {
        create: async () => ({ id: "performance-draft", currentVersion: 1 }),
      },
    } as never);
    const saveOrCreate: number[] = [];
    for (let index = 0; index < 20; index += 1)
      saveOrCreate.push(
        await measure(() =>
          service.save({
            userId: "performance-user",
            idempotencyKey: `performance-${index}`,
            value: sample,
          }),
        ),
      );

    expect(
      evaluateScheduledTaskRelease({
        latencyMs: { localEdit, semanticValidation, saveOrCreate },
        deterministicPathWaitsForAgent: false,
        contractChecks: {
          web: true,
          python: true,
          cppWorker: true,
          postgresql: true,
        },
        forbiddenCapabilities: [],
      }),
    ).toMatchObject({ allowed: true, failures: [] });
  });

  it("固定样本的 P95 达标且确定性路径不等待 Agent 时允许发布", () => {
    const result = evaluateScheduledTaskRelease({
      latencyMs: {
        localEdit: [12, 18, 25, 30, 42],
        semanticValidation: [210, 260, 320, 410, 520],
        saveOrCreate: [520, 650, 710, 820, 1_020],
      },
      deterministicPathWaitsForAgent: false,
      contractChecks: {
        web: true,
        python: true,
        cppWorker: true,
        postgresql: true,
      },
      forbiddenCapabilities: [],
    });

    expect(result).toEqual({
      allowed: true,
      p95Ms: { localEdit: 42, semanticValidation: 520, saveOrCreate: 1_020 },
      failures: [],
    });
  });

  it("任一性能、跨模块契约或边界失败时阻断发布", () => {
    const result = evaluateScheduledTaskRelease({
      latencyMs: {
        localEdit: [101],
        semanticValidation: [801],
        saveOrCreate: [1_501],
      },
      deterministicPathWaitsForAgent: true,
      contractChecks: {
        web: true,
        python: false,
        cppWorker: true,
        postgresql: false,
      },
      forbiddenCapabilities: ["ARBITRARY_CRON", "AUTO_ACTIVATE"],
    });

    expect(result.allowed).toBe(false);
    expect(result.failures).toEqual([
      "LOCAL_EDIT_P95",
      "SEMANTIC_VALIDATION_P95",
      "SAVE_OR_CREATE_P95",
      "AGENT_BLOCKS_DETERMINISTIC_PATH",
      "PYTHON_CONTRACT",
      "POSTGRESQL_CONTRACT",
      "FORBIDDEN_CAPABILITY:ARBITRARY_CRON",
      "FORBIDDEN_CAPABILITY:AUTO_ACTIVATE",
    ]);
  });

  it("拒绝缺失或无效的延迟证据", () => {
    expect(() =>
      evaluateScheduledTaskRelease({
        latencyMs: {
          localEdit: [],
          semanticValidation: [100],
          saveOrCreate: [Number.NaN],
        },
        deterministicPathWaitsForAgent: false,
        contractChecks: {
          web: true,
          python: true,
          cppWorker: true,
          postgresql: true,
        },
        forbiddenCapabilities: [],
      }),
    ).toThrow("INVALID_LATENCY_EVIDENCE");
  });
});
