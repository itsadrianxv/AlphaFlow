import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("定时任务 Redis Streams", () => {
  it("scheduler 使用 consumer group、pending 接管和 ACK", async () => {
    const source = await readFile(
      path.join(root, "tooling/workers/scheduled-task-scheduler.ts"),
      "utf8",
    );
    expect(source).toContain('xgroup("CREATE"');
    expect(source).toContain("xreadgroup");
    expect(source).toContain("xautoclaim");
    expect(source).toContain("xack");
    expect(source).not.toContain("/runs/${runId}");
  });

  it("结果先通过内部接口落库，再发布终态事件", async () => {
    const source = await readFile(
      path.join(root, "../agent_runtime/src/pi-adapter.ts"),
      "utf8",
    );
    const persistAt = source.indexOf("persistScheduledTaskResult(executionId");
    const publishAt = source.indexOf(
      'publishScheduled("execution.succeeded"',
    );
    expect(persistAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(persistAt);
  });

  it("delivery 模块不接收 Agent 上下文中的 webhook URL", async () => {
    const scheduler = await readFile(
      path.join(root, "tooling/workers/scheduled-task-scheduler.ts"),
      "utf8",
    );
    const agent = await readFile(
      path.join(root, "../agent_runtime/src/scheduled-task-events.ts"),
      "utf8",
    );
    expect(scheduler).toContain("deliverScheduledTask");
    expect(agent).not.toContain("webhook");
  });

  it("外部投递使用 SENDING 原子认领且仅确认结果后写入 SENT", async () => {
    const scheduler = await readFile(
      path.join(root, "tooling/workers/scheduled-task-scheduler.ts"),
      "utf8",
    );
    expect(scheduler).toContain('data: { status: "SENDING"');
    expect(scheduler).toContain('if (result.outcome !== "SENT")');
    expect(scheduler).toContain('spec?.type === "FEISHU"');
    expect(scheduler).not.toContain("skipped: true");
  });
});
