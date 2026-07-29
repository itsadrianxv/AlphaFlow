import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledTaskEditService } from "~/server/application/scheduled-task/scheduled-task-edit-service";
import { ScheduledTaskExecutionService } from "~/server/application/scheduled-task/scheduled-task-execution-service";
import { scheduledTaskOutputSpecSchema } from "~/server/domain/scheduled-task/contracts";

const root = path.resolve(import.meta.dirname, "..");

afterEach(() => vi.unstubAllGlobals());

describe("定时任务管理契约", () => {
  it("为旧输出配置补齐详略和空结果默认值", () => {
    expect(
      scheduledTaskOutputSpecSchema.parse({
        format: "MARKDOWN",
        includeEvidence: true,
      }),
    ).toEqual({
      format: "MARKDOWN",
      includeEvidence: true,
      detailLevel: "STANDARD",
      sendOnEmpty: true,
    });
  });

  it("确认候选时按基础版本创建新版本且不改变任务状态", async () => {
    const taskUpdates: Array<Record<string, unknown>> = [];
    const versions: Array<Record<string, unknown>> = [];
    const draft = {
      id: "cm1234567890123456789012",
      taskId: "cm2234567890123456789012",
      userId: "user-1",
      conversationId: null,
      source: "STRUCTURED",
      status: "PENDING",
      baseVersion: 2,
      revision: 1,
      name: "更新后的任务",
      userPrompt: "关注目标",
      scheduleSpec: {
        type: "DAILY",
        time: "09:30",
        timezone: "Asia/Shanghai",
      },
      dataSources: [],
      executionPlan: {},
      outputSpec: {
        format: "MARKDOWN",
        includeEvidence: true,
        detailLevel: "STANDARD",
        sendOnEmpty: true,
      },
      deliverySpec: { type: "SAVE_ONLY" },
      feasibility: { status: "SUPPORTED" },
      changes: [],
      nextRunAt: new Date("2026-07-29T01:30:00.000Z"),
    };
    const tx = {
      scheduledTask: {
        updateMany: vi.fn(async (args) => {
          taskUpdates.push(args);
          return { count: 1 };
        }),
      },
      scheduledTaskVersion: {
        create: vi.fn(async (args) => {
          versions.push(args);
          return args.data;
        }),
      },
      scheduledTaskEditDraft: {
        update: vi.fn(async () => draft),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      agentConversation: { updateMany: vi.fn() },
    };
    const db = {
      scheduledTaskEditDraft: {
        findFirst: vi.fn(async () => draft),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await new ScheduledTaskEditService(db as never).confirm({
      userId: "user-1",
      draftId: draft.id,
      expectedRevision: 1,
    });

    expect(result).toEqual({ taskId: draft.taskId, version: 3 });
    expect(taskUpdates[0]).toMatchObject({
      where: { currentVersion: 2, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { currentVersion: 3, name: "更新后的任务" },
    });
    expect((taskUpdates[0] as { data: object }).data).not.toHaveProperty(
      "status",
    );
    expect(versions[0]).toMatchObject({ data: { version: 3 } });
  });

  it("试执行创建手动记录并沿用当前正式版本", async () => {
    const creates: Array<Record<string, unknown>> = [];
    const task = {
      id: "cm3234567890123456789012",
      userId: "user-1",
      status: "PAUSED",
      currentVersion: 4,
      nextRunAt: new Date("2026-07-29T01:30:00.000Z"),
      versions: [
        {
          id: "cm4234567890123456789012",
          version: 4,
          executionPlan: { allowedCapabilities: [] },
          deliverySpec: { type: "SAVE_ONLY" },
        },
      ],
    };
    const db = {
      scheduledTaskExecution: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args) => {
          creates.push(args);
          return {
            id: "cm5234567890123456789012",
            scheduledAt: args.data.scheduledAt,
          };
        }),
        update: vi.fn(async () => ({})),
      },
      scheduledTask: { findFirst: vi.fn(async () => task) },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));

    const result = await new ScheduledTaskExecutionService(
      db as never,
    ).trialRun({
      userId: "user-1",
      taskId: task.id,
      deliver: false,
      idempotencyKey: "manual-request-1",
    });

    expect(result).toEqual({
      executionId: "cm5234567890123456789012",
      submitted: true,
    });
    expect(creates[0]).toMatchObject({
      data: {
        taskVersionId: task.versions[0]?.id,
        trigger: "MANUAL",
        deliveryRequested: false,
      },
    });
    expect(db.scheduledTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["ACTIVE", "PAUSED"] },
        }),
      }),
    );
  });
});

describe("定时任务详情页面", () => {
  it("提供五个详情板块和默认不投递的试执行弹窗", async () => {
    const source = await readFile(
      path.join(
        root,
        "app/scheduled-tasks/[id]/scheduled-task-detail-client.tsx",
      ),
      "utf8",
    );
    for (const title of [
      "任务内容",
      "执行计划",
      "投递设置",
      "执行记录",
      "编辑任务",
    ]) {
      expect(source).toContain(title);
    }
    expect(source).toContain("const [deliver, setDeliver] = useState(false)");
    expect(source).toContain("结构化编辑");
    expect(source).toContain("和 Agent 讨论修改");
  });

  it("列表只增加详情和编辑入口", async () => {
    const source = await readFile(
      path.join(root, "app/scheduled-tasks/scheduled-tasks-client.tsx"),
      "utf8",
    );
    expect(source).toContain("详情");
    expect(source).toContain("编辑");
    expect(source).not.toContain("试执行");
  });
});
