import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/skill-registry";
import { createInternalTools, STANDARD_INTERNAL_TOOL_NAMES } from "../src/tool-policy";
import { SCHEDULED_TASK_SETUP_TOOL_NAMES } from "../src/scheduled-task-setup-tools";
import { createScheduledTaskSetupTools } from "../src/scheduled-task-setup-tools";

describe("scheduled task tools", () => {
  it("保留 Skill 不出现在用户可选列表", async () => {
    const registry = await new SkillRegistry().load();
    const ids = registry.list().map((skill) => skill.id);
    expect(ids).not.toContain("scheduled-task-setup");
    expect(ids).not.toContain("scheduled-task-execution");
    expect(registry.get("scheduled-task-setup")).not.toBeNull();
  });

  it("普通工具白名单不包含 setup 和原始 TuShare 工具", () => {
    expect(STANDARD_INTERNAL_TOOL_NAMES).not.toContain("internal_tushare_dataset" as never);
    for (const name of SCHEDULED_TASK_SETUP_TOOL_NAMES) expect(STANDARD_INTERNAL_TOOL_NAMES).not.toContain(name as never);
  });

  it("拒绝执行计划外的 TuShare 数据集和超长窗口", async () => {
    const tools = createInternalTools({
      pythonGatewayClient: { postJson: async () => ({ ok: true }) } as never,
      webInternalClient: {} as never,
      runId: "run-1",
      userId: "user-1",
      maxToolCalls: 10,
      toolTimeoutMs: 1000,
      capabilityConstraints: { internal_tushare_dataset: { allowedDatasets: ["moneyflow"], maxRows: 10, maxLookbackDays: 5 } },
    });
    const tool = tools.find((item) => item.name === "internal_tushare_dataset");
    expect(tool).toBeDefined();
    await expect(tool?.execute("call-1", { dataset: "income", params: {} }, undefined)).rejects.toThrow("未授权");
    await expect(tool?.execute("call-2", { dataset: "moneyflow", params: { start_date: "20260701", end_date: "20260720" } }, undefined)).rejects.toThrow("回看窗口");
  });

  it("拒绝裸 TuShare 股票代码并允许规范代码", async () => {
    let calls = 0;
    const tools = createInternalTools({
      pythonGatewayClient: { postJson: async () => { calls += 1; return { rows: [] }; } } as never,
      webInternalClient: {} as never,
      runId: "run-code",
      userId: "user-code",
      maxToolCalls: 10,
      toolTimeoutMs: 1000,
      capabilityConstraints: { internal_tushare_dataset: { allowedDatasets: ["fina_mainbz"], maxRows: 10, maxLookbackDays: 365 } },
    });
    const tool = tools.find((item) => item.name === "internal_tushare_dataset");
    await expect(tool?.execute("call-bare", { dataset: "fina_mainbz", params: { ts_code: "601138" } }, undefined)).rejects.toThrow("INVALID_TUSHARE_TS_CODE");
    await expect(tool?.execute("call-full", { dataset: "fina_mainbz", params: { ts_code: "601138.SH" } }, undefined)).resolves.toBeDefined();
    expect(calls).toBe(1);
  });

  it("定时任务设置工具使用独立短超时", async () => {
    const tools = createScheduledTaskSetupTools({
      webInternalClient: {
        postScheduledTaskSetupOperation: async (
          _payload: unknown,
          signal?: AbortSignal,
        ) =>
          new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason),
              { once: true },
            );
          }),
      } as never,
      runId: "run-timeout",
      userId: "user-timeout",
      conversationId: "conversation-timeout",
      timeoutMs: 10,
    });

    await expect(
      tools[0]?.execute("call-timeout", {}, undefined),
    ).rejects.toThrow("定时任务工具调用超时");
  });
});
