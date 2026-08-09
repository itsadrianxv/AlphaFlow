import { afterEach, describe, expect, it, vi } from "vitest";

import { FeishuDeliveryError } from "~/server/application/research-distribution/research-distribution-service";
import { FeishuWebhookDeliveryAdapter } from "~/server/infrastructure/research-distribution/feishu-webhook-delivery-adapter";

const registry = JSON.stringify([
  { type: "FEISHU", targetRef: "research-alerts", name: "投研提醒", secretEnvVar: "FEISHU_WEBHOOK_URL_RESEARCH_ALERTS" },
]);
const payload = { idempotencyKey: "feishu:inbox-1", title: "研究事件", reason: "满足紧急提醒的确定性门槛", status: "已核实", inboxLink: "/research/inbox/inbox-1" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configure() {
  vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
  vi.stubEnv("FEISHU_WEBHOOK_URL_RESEARCH_ALERTS", "https://open.feishu.cn/open-apis/bot/v2/hook/test-token");
}

describe("研究分发 Feishu Webhook adapter", () => {
  it("发送只包含必要内容的文本副本", async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 }));
    await new FeishuWebhookDeliveryAdapter("research-alerts", fetcher).send(payload);
    const [, request] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(request.body))).toEqual({ msg_type: "text", content: { text: "研究事件\n状态：已核实\n理由：满足紧急提醒的确定性门槛\n站内：/research/inbox/inbox-1" } });
  });

  it.each([
    { response: new Response("", { status: 503 }), code: "FEISHU_HTTP_503", retryable: true, outcome: "FAILURE" },
    { response: new Response("", { status: 429 }), code: "FEISHU_HTTP_429", retryable: true, outcome: "RATE_LIMITED" },
    { response: new Response(JSON.stringify({ code: 19001, msg: "invalid webhook" }), { status: 200 }), code: "FEISHU_BUSINESS_19001", retryable: true, outcome: "FAILURE" },
  ])("将 HTTP/业务失败分类为结构化投递错误", async ({ response, code, retryable, outcome }) => {
    configure();
    const adapter = new FeishuWebhookDeliveryAdapter("research-alerts", vi.fn().mockResolvedValue(response));
    const error = await adapter.send(payload).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(FeishuDeliveryError);
    expect(error).toMatchObject({ code, retryable, resourceOutcome: outcome });
  });

  it("目标 Webhook 配置错误只形成不可重试的单目标错误", async () => {
    vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
    vi.stubEnv("FEISHU_WEBHOOK_URL_RESEARCH_ALERTS", "http://invalid.example/hook");
    const error = await new FeishuWebhookDeliveryAdapter("research-alerts")
      .send(payload)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "FEISHU_WEBHOOK_INVALID", retryable: false });
  });
});
