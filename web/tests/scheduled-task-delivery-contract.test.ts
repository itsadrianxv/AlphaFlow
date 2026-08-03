import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import {
  scheduledTaskDeliverySpecSchema,
  scheduledTaskDraftInputSchema,
  scheduledTaskOutputSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import {
  listDeliveryTargets,
  resolveFeishuWebhook,
} from "~/server/domain/scheduled-task/delivery-targets";
import {
  DeliveryAttemptError,
  deliverScheduledTask,
} from "../tooling/scheduler-delivery";

const registry = JSON.stringify([
  {
    type: "FEISHU",
    targetRef: "research-alerts",
    name: "投研提醒群",
    secretEnvVar: "FEISHU_WEBHOOK_URL_RESEARCH_ALERTS",
  },
]);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("定时任务输出与投递契约", () => {
  it("禁止把 Webhook 放进 output，并要求明确 delivery", () => {
    expect(
      scheduledTaskOutputSpecSchema.safeParse({
        format: "MARKDOWN",
        includeEvidence: true,
        url: "https://example.invalid/hook",
      }).success,
    ).toBe(false);
    expect(
      scheduledTaskDraftInputSchema.safeParse({
        name: "测试任务",
        userPrompt: "测试",
        schedule: { type: "DAILY", time: "12:00", timezone: "Asia/Shanghai" },
        dataSources: [{ provider: "tushare", capability: "tushare.daily", parameters: {} }],
        output: { format: "MARKDOWN", includeEvidence: true },
      }).success,
    ).toBe(false);
    expect(
      scheduledTaskDeliverySpecSchema.safeParse({
        type: "FEISHU",
        targetRef: "research-alerts",
      }).success,
    ).toBe(true);
  });

  it("只向 Agent 暴露目标元数据，不暴露密钥变量名", () => {
    vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
    expect(listDeliveryTargets()).toEqual([
      { type: "FEISHU", targetRef: "research-alerts", name: "投研提醒群" },
    ]);
    expect(listDeliveryTargets()[0]).not.toHaveProperty("secretEnvVar");
  });

  it("未配置目标密钥时拒绝解析", () => {
    vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
    vi.stubEnv("FEISHU_WEBHOOK_URL_RESEARCH_ALERTS", "");
    expect(() => resolveFeishuWebhook("research-alerts")).toThrow(
      "FEISHU_WEBHOOK_NOT_CONFIGURED",
    );
  });

  it("没有注册目标时阻止保存飞书草稿", async () => {
    vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", "[]");
    const service = new ScheduledTaskSetupService({} as never);
    const result = await service.validateDraft({
      name: "飞书任务",
      userPrompt: "发送投研摘要",
      schedule: { type: "DAILY", time: "12:00", timezone: "Asia/Shanghai" },
      dataSources: [
        { provider: "tavily", capability: "internal_web_search", parameters: {} },
      ],
      output: { format: "MARKDOWN", includeEvidence: true },
      delivery: { type: "FEISHU", targetRef: "research-alerts" },
    });
    expect(result.feasibility.blockingIssues).toContain(
      "飞书投递目标未配置或不可用",
    );
  });
});

describe("飞书投递结果", () => {
  function configure() {
    vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
    vi.stubEnv(
      "FEISHU_WEBHOOK_URL_RESEARCH_ALERTS",
      "https://open.feishu.cn/open-apis/bot/v2/hook/test-token",
    );
  }

  it("只有 HTTP 与业务状态都成功才返回 SENT", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 0, msg: "success" }), {
          status: 200,
        }),
      ),
    );
    await expect(
      deliverScheduledTask(
        { type: "FEISHU", targetRef: "research-alerts" },
        { title: "测试", body: "内容" },
      ),
    ).resolves.toMatchObject({ outcome: "SENT" });
  });

  it("HTTP 200 但飞书业务失败时返回永久失败", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 19001, msg: "invalid webhook" }), {
          status: 200,
        }),
      ),
    );
    const error = await deliverScheduledTask(
      { type: "FEISHU", targetRef: "research-alerts" },
      { body: "内容" },
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DeliveryAttemptError);
    expect(error).toMatchObject({ retryable: false, code: "FEISHU_BUSINESS_19001" });
  });

  it("HTTP 5xx 标记为可重试错误", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const error = await deliverScheduledTask(
      { type: "FEISHU", targetRef: "research-alerts" },
      { body: "内容" },
    ).catch((value: unknown) => value);
    expect(error).toMatchObject({ retryable: true, code: "FEISHU_HTTP_503" });
  });

  it("网络错误不回显 Webhook 凭证", async () => {
    const secretWebhook =
      "https://open.feishu.cn/open-apis/bot/v2/hook/top-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`connect failed: ${secretWebhook}`)),
    );
    const error = await deliverScheduledTask(
      { type: "FEISHU", targetRef: "credential-1" },
      { body: "内容" },
      { resolveWebhook: async () => secretWebhook },
    ).catch((value: unknown) => value);
    expect(error).toMatchObject({
      retryable: true,
      code: "FEISHU_NETWORK_ERROR",
      message: "飞书 Webhook 网络请求失败",
    });
    expect(JSON.stringify(error)).not.toContain("top-secret-token");
  });
});
