import { describe, expect, it } from "vitest";
import type { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { ScheduledTaskIntentRouter } from "~/server/application/scheduled-task/scheduled-task-intent-router";

describe("ScheduledTaskIntentRouter", () => {
  const unavailableClient = { isConfigured: () => false } as unknown as DeepSeekClient;
  const router = new ScheduledTaskIntentRouter(unavailableClient);

  it("识别明确的新建定时任务表达", async () => {
    await expect(router.shouldEnterSetup("每天收盘后发送我的自选股简报")).resolves.toBe(true);
    await expect(router.shouldEnterSetup("帮我设置一个每周一的资金流提醒")).resolves.toBe(true);
  });

  it("不把任务管理和普通投研问题当作新建任务", async () => {
    await expect(router.shouldEnterSetup("查看我有哪些定时任务")).resolves.toBe(false);
    await expect(router.shouldEnterSetup("分析贵州茅台最近的估值")).resolves.toBe(false);
  });
});
