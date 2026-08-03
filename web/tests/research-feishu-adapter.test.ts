import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuDeliveryError } from "~/server/application/research-distribution/research-distribution-service";
import { FeishuWebhookDeliveryAdapter } from "~/server/infrastructure/research-distribution/feishu-webhook-delivery-adapter";
import { PostgresFeishuDeliveryGuard } from "~/server/infrastructure/research-distribution/postgres-feishu-delivery-guard";
import { ResourcePermitUnavailableError } from "~/server/domain/scheduling/types";

const registry = JSON.stringify([
  {
    type: "FEISHU",
    targetRef: "research-alerts",
    name: "投研提醒",
    secretEnvVar: "FEISHU_WEBHOOK_URL_RESEARCH_ALERTS",
  },
]);

const payload = {
  idempotencyKey: "feishu:inbox-1",
  title: "研究事件",
  reason: "满足紧急提醒的确定性门槛",
  status: "已核实",
  inboxLink: "/research/inbox/inbox-1",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configure() {
  vi.stubEnv("SCHEDULED_TASK_DELIVERY_TARGETS_JSON", registry);
  vi.stubEnv(
    "FEISHU_WEBHOOK_URL_RESEARCH_ALERTS",
    "https://open.feishu.cn/open-apis/bot/v2/hook/test-token",
  );
}

describe("研究分发 Feishu Webhook adapter", () => {
  it("发送只包含必要内容的文本副本", async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: "success" }), {
        status: 200,
      }),
    );
    const adapter = new FeishuWebhookDeliveryAdapter("research-alerts", fetcher);

    await adapter.send(payload);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, request] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(request.body))).toEqual({
      msg_type: "text",
      content: {
        text: "研究事件\n状态：已核实\n理由：满足紧急提醒的确定性门槛\n站内：/research/inbox/inbox-1",
      },
    });
  });

  it.each([
    { response: new Response("", { status: 503 }), code: "FEISHU_HTTP_503", retryable: true },
    { response: new Response("", { status: 429 }), code: "FEISHU_HTTP_429", retryable: true },
    { response: new Response(JSON.stringify({ code: 19001, msg: "invalid webhook" }), { status: 200 }), code: "FEISHU_BUSINESS_19001", retryable: false },
  ])("将 HTTP/业务失败分类为结构化投递错误", async ({ response, code, retryable }) => {
    configure();
    const adapter = new FeishuWebhookDeliveryAdapter(
      "research-alerts",
      vi.fn().mockResolvedValue(response),
    );

    const error = await adapter.send(payload).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(FeishuDeliveryError);
    expect(error).toMatchObject({ code, retryable });
  });
});

describe("Feishu 投递 F02 许可 guard", () => {
  const context = {
    taskId: "task-1",
    resourcePoolId: "pool-feishu",
    holderId: "worker-1",
    fencingToken: 3n,
    permitKey: "permit-1",
  };

  it("校验已 claim 的 PostgreSQL 许可并记录资源池成功结果", async () => {
    const acquireNestedPermit = vi.fn().mockResolvedValue({ id: "permit-1" });
    const releasePermit = vi.fn().mockResolvedValue(undefined);
    const recordOutcome = vi.fn().mockResolvedValue({});
    const guard = new PostgresFeishuDeliveryGuard(
      { acquireNestedPermit, releasePermit, recordOutcome } as never,
      context,
    );
    const operation = vi.fn().mockResolvedValue(undefined);

    await guard.run("copy-1", operation);

    expect(acquireNestedPermit).toHaveBeenCalledWith({
      taskId: "task-1",
      resourcePoolId: "pool-feishu",
      holderId: "worker-1",
      fencingToken: 3n,
      permitKey: "permit-1",
    });
    expect(recordOutcome).toHaveBeenCalledWith("pool-feishu", {
      kind: "SUCCESS",
    });
    expect(releasePermit).toHaveBeenCalledWith(
      "permit-1",
      "worker-1",
      3n,
      "feishu_delivery_finished",
    );
  });

  it("外部发送失败后仍释放 PostgreSQL 许可", async () => {
    const acquireNestedPermit = vi.fn().mockResolvedValue({ id: "permit-2" });
    const releasePermit = vi.fn().mockResolvedValue(undefined);
    const recordOutcome = vi.fn().mockResolvedValue({});
    const guard = new PostgresFeishuDeliveryGuard(
      { acquireNestedPermit, releasePermit, recordOutcome } as never,
      context,
    );

    await expect(
      guard.run("copy-2", async () => {
        throw new FeishuDeliveryError("FEISHU_HTTP_503", true);
      }),
    ).rejects.toMatchObject({ code: "FEISHU_HTTP_503" });
    expect(releasePermit).toHaveBeenCalledWith(
      "permit-2",
      "worker-1",
      3n,
      "feishu_delivery_finished",
    );
  });

  it("资源池熔断时不调用外部发送并返回可重试结构化错误", async () => {
    const scheduler = {
      acquireNestedPermit: vi
        .fn()
        .mockRejectedValue(new ResourcePermitUnavailableError()),
      getCircuit: vi.fn().mockResolvedValue({
        state: "OPEN",
        retryAfter: new Date(Date.now() + 60_000),
      }),
    };
    const guard = new PostgresFeishuDeliveryGuard(scheduler as never, context);
    const operation = vi.fn();

    const error = await guard.run("copy-1", operation).catch((value) => value);

    expect(operation).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      code: "FEISHU_RESOURCE_UNAVAILABLE",
      retryable: true,
    });
  });
});
