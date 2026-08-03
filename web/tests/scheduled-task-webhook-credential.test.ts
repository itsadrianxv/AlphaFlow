import { describe, expect, it } from "vitest";
import {
  decryptFeishuWebhook,
  encryptFeishuWebhook,
  maskFeishuWebhook,
  validateFeishuWebhook,
} from "~/server/domain/scheduled-task/feishu-webhook-credential";
import { ScheduledTaskWebhookCredentialService } from "~/server/application/scheduled-task/scheduled-task-webhook-credential-service";
import { buildScoringDeliveryMessage } from "../tooling/scheduler-delivery";

const webhook = "https://open.feishu.cn/open-apis/bot/v2/hook/abc_DEF-123456";

describe("飞书 Webhook 凭证边界", () => {
  it("只接受飞书官方 HTTPS Webhook 格式", () => {
    expect(validateFeishuWebhook(webhook)).toBe(webhook);
    for (const invalid of [
      "http://open.feishu.cn/open-apis/bot/v2/hook/token",
      "https://example.com/open-apis/bot/v2/hook/token",
      "https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/token",
      "https://open.feishu.cn/other/token",
    ])
      expect(() => validateFeishuWebhook(invalid)).toThrow(
        "FEISHU_WEBHOOK_INVALID",
      );
  });

  it("使用认证加密保存并只公开脱敏值", () => {
    const encrypted = encryptFeishuWebhook(webhook, "unit-test-key");
    expect(encrypted).not.toContain("abc_DEF");
    expect(decryptFeishuWebhook(encrypted, "unit-test-key")).toBe(webhook);
    expect(maskFeishuWebhook(webhook)).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/****3456",
    );
  });

  it("数据库仅保存密文，公开读取与任务版本只使用不透明引用", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = {
      scheduledTaskDeliveryCredential: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "credential-1", ...data };
          rows.push(row);
          return row;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          rows.find(
            (row) =>
              row.id === where.id &&
              (!where.userId || row.userId === where.userId) &&
              (!where.taskId || row.taskId === where.taskId),
          ) ?? null,
      },
    };
    const service = new ScheduledTaskWebhookCredentialService(
      db as never,
      "unit-test-key",
    );

    const registered = await service.register({
      userId: "user-1",
      taskId: "task-1",
      webhookUrl: webhook,
    });
    expect(registered).toEqual({
      credentialRef: "credential-1",
      maskedWebhook: "https://open.feishu.cn/open-apis/bot/v2/hook/****3456",
    });
    expect(JSON.stringify(rows)).not.toContain("abc_DEF");
    await expect(
      service.resolveForDelivery("credential-1"),
    ).resolves.toBe(webhook);
    await expect(
      service.describe({ userId: "user-1", taskId: "task-1", credentialRef: "credential-1" }),
    ).resolves.toEqual(registered);
  });
});

describe("确定性评分飞书摘要", () => {
  it("固定发送 Top N 和站内结果及 Excel 链接", () => {
    const message = buildScoringDeliveryMessage({
      taskName: "收盘评分",
      taskId: "task-1",
      executionId: "execution-1",
      baseUrl: "https://alphaflow.example",
      asOfDate: "2026-08-03",
      evaluatedCount: 300,
      universeCount: 5000,
      selectedCount: 3,
      summaryLimit: 2,
      rows: [
        { rank: 1, stockCode: "600519", stockName: "贵州茅台", score: 95 },
        { rank: 2, stockCode: "000001", stockName: "平安银行", score: 90 },
        { rank: 3, stockCode: "300750", stockName: "宁德时代", score: 88 },
      ],
    });
    expect(message.body).toContain("1. 贵州茅台（600519） 95 分");
    expect(message.body).toContain("2. 平安银行（000001） 90 分");
    expect(message.body).not.toContain("宁德时代");
    expect(message.body).toContain(
      "https://alphaflow.example/scheduled-tasks/task-1?executionId=execution-1",
    );
    expect(message.body).toContain(
      "https://alphaflow.example/api/scheduled-tasks/executions/execution-1/export",
    );
  });
});
