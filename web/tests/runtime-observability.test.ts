import { describe, expect, it } from "vitest";
import {
  InMemoryRuntimeObservabilityRepository,
  RuntimeObservabilityService,
} from "~/server/application/runtime-observability/runtime-observability-service";
import { resolveRuntimeTargets } from "~/server/domain/runtime-observability/runtime-targets";

const at = (seconds: number) => new Date(`2026-08-03T00:00:${seconds.toString().padStart(2, "0")}Z`);

function service() {
  return new RuntimeObservabilityService(
    new InMemoryRuntimeObservabilityRepository(),
  );
}

describe("运行观测", () => {
  it("为数据组和产品阶段提供 Spec §14 初始目标", () => {
    expect(
      resolveRuntimeTargets({ dataset: "news", stage: "INSTANT_RESEARCH" }),
    ).toEqual({
      sourceTargetMs: 120_000,
      productTargetMs: 90_000,
      deliveryTargetMs: null,
    });
    expect(
      resolveRuntimeTargets({ stage: "FEISHU_SETTLED", delivery: true }),
    ).toEqual({
      sourceTargetMs: null,
      productTargetMs: 120_000,
      deliveryTargetMs: 120_000,
    });
  });

  it("同时计算来源时钟、产品时钟，并要求实际数据截止点达标", async () => {
    const runtime = service();

    const result = await runtime.record({
      idempotencyKey: "sample-dual-clock",
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
      tradingDate: "2026-08-03",
      sourceClockAt: at(0),
      sourceClockKind: "PUBLISHED_AT",
      productClockAt: at(10),
      readyAt: at(40),
      actualDataCutoff: at(20),
      targetDataCutoff: at(30),
      sourceTargetMs: 60_000,
      productTargetMs: 45_000,
    });

    expect(result.sourceLatencyMs).toBe(40_000);
    expect(result.sourceClockKind).toBe("PUBLISHED_AT");
    expect(result.productLatencyMs).toBe(30_000);
    expect(result.dataCutoffMet).toBe(false);
    expect(result.breaches.map((item) => item.kind)).toContain("DATA_CUTOFF");
    expect(result.alerts.map((item) => item.thresholdPercent)).toEqual([50, 50]);
  });

  it("声明目标数据截止点但没有实际截止点时记录违约", async () => {
    const runtime = service();
    const result = await runtime.record({
      idempotencyKey: "missing-cutoff",
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
      tradingDate: "2026-08-03",
      readyAt: at(40),
      actualDataCutoff: null,
      targetDataCutoff: at(30),
    });

    expect(result.dataCutoffMet).toBe(false);
    expect(result.breaches.map((item) => item.kind)).toContain("DATA_CUTOFF");
  });

  it("按来源、数据集、阶段分段计算 p50/p95，并统计降级率与积压年龄", async () => {
    const runtime = service();
    for (const [index, latencyMs] of [100, 200, 300, 400, 500].entries()) {
      await runtime.record({
        idempotencyKey: `segment-${index}`,
        source: "minishare",
        dataset: "news",
        stage: "CONTINUOUS",
        tradingDate: "2026-08-03",
        sourceClockAt: new Date(0),
        productClockAt: new Date(0),
        readyAt: new Date(latencyMs),
        actualDataCutoff: new Date(latencyMs),
        sourceTargetMs: 1_000,
        productTargetMs: 1_000,
        degraded: index === 4,
        backlogAgeMs: latencyMs,
      });
    }

    const [metric] = await runtime.query({
      source: "minishare",
      dataset: "news",
      stage: "CONTINUOUS",
    });
    if (!metric) throw new Error("缺少分段指标");

    expect(metric).toMatchObject({
      sampleCount: 5,
      targetMetRate: 1,
      degradedRate: 0.2,
      sourceLatencyMs: { p50: 300, p95: 500 },
      productLatencyMs: { p50: 300, p95: 500 },
      backlogAgeMs: { p50: 300, p95: 500, max: 500 },
    });
  });

  it("按最近 20 个交易日滚动统计，不用平均值掩盖 p95", async () => {
    const runtime = service();
    for (let day = 1; day <= 21; day += 1) {
      const tradingDate = `2026-07-${day.toString().padStart(2, "0")}`;
      await runtime.record({
        idempotencyKey: `rolling-${day}`,
        source: "tushare",
        dataset: "daily",
        stage: "POST_MARKET",
        tradingDate,
        sourceClockAt: new Date(0),
        productClockAt: new Date(0),
        readyAt: new Date(day === 1 ? 99_999 : 100),
        actualDataCutoff: new Date(100),
        sourceTargetMs: 1_000,
        productTargetMs: 1_000,
      });
    }

    const [metric] = await runtime.query({
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
      asOfTradingDate: "2026-07-21",
      rollingTradingDays: 20,
    });
    if (!metric) throw new Error("缺少滚动指标");

    expect(metric.sampleCount).toBe(20);
    expect(metric.sourceLatencyMs.p95).toBe(100);
    expect(metric.rollingTradingDays).toEqual(
      expect.arrayContaining(["2026-07-02", "2026-07-21"]),
    );
    expect(metric.rollingTradingDays).not.toContain("2026-07-01");

    const [defaultMetric] = await runtime.query({
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
    });
    expect(defaultMetric?.sampleCount).toBe(20);
  });

  it("在 50%/100% 目标阈值产生幂等告警，并记录运行目标违约", async () => {
    const runtime = service();
    const input = {
      idempotencyKey: "threshold-sample",
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
      tradingDate: "2026-08-03",
      sourceClockAt: new Date(0),
      productClockAt: new Date(0),
      readyAt: new Date(1_000),
      actualDataCutoff: new Date(1_000),
      sourceTargetMs: 1_000,
    } as const;

    const first = await runtime.record(input);
    expect(first.alerts.map((alert) => alert.thresholdPercent)).toEqual([100]);
    expect(first.breaches.map((breach) => breach.kind)).toContain(
      "SOURCE_CLOCK",
    );

    const duplicate = await runtime.record(input);
    expect(duplicate.id).toBe(first.id);
    expect((await runtime.listAlerts()).length).toBe(1);
    expect((await runtime.listBreaches()).length).toBe(1);
  });

  it("在达到预算一半但尚未失守时只产生预警，不记录违约", async () => {
    const runtime = service();
    const result = await runtime.record({
      idempotencyKey: "warning-sample",
      source: "tushare",
      dataset: "daily",
      stage: "POST_MARKET",
      tradingDate: "2026-08-03",
      sourceClockAt: new Date(0),
      productClockAt: new Date(0),
      readyAt: new Date(600),
      actualDataCutoff: new Date(600),
      sourceTargetMs: 1_000,
      productTargetMs: 10_000,
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]?.thresholdPercent).toBe(50);
    expect(result.breaches).toEqual([]);
  });

  it("记录许可、熔断、用量和投递维度，并在聚合中可查询", async () => {
    const runtime = service();
    await runtime.record({
      idempotencyKey: "resource-sample",
      stage: "FEISHU_DELIVERY",
      resourcePool: "feishu",
      tradingDate: "2026-08-03",
      sourceClockAt: null,
      productClockAt: new Date(0),
      readyAt: new Date(200),
      actualDataCutoff: null,
      permit: { state: "ACQUIRED", waitMs: 40, heldMs: 160 },
      circuit: { state: "HALF_OPEN" },
      usage: { requests: 1, inputTokens: 12, outputTokens: 8, costMicros: 99 },
      delivery: { channel: "FEISHU", status: "SENT", attempt: 1, latencyMs: 200 },
    });

    const [metric] = await runtime.query({ resourcePool: "feishu" });
    if (!metric) throw new Error("缺少资源池指标");
    expect(metric).toMatchObject({
      permit: { acquired: 1, averageWaitMs: 40 },
      circuit: { halfOpen: 1 },
      usage: { requests: 1, inputTokens: 12, outputTokens: 8, costMicros: 99 },
      delivery: { sent: 1, attempts: 1, p95LatencyMs: 200 },
    });

    await runtime.recordResourceSnapshot({
      idempotencyKey: "resource-restart",
      resourcePool: "feishu",
      observedAt: new Date(300),
      permit: { state: "RELEASED" },
      adaptive: {
        previous: 4,
        current: 1,
        hardLimit: 8,
        reason: "RESTART_CONSERVATIVE",
      },
    });
    const updatedMetric = (await runtime.query({ resourcePool: "feishu" })).find(
      (item) => item.permit.released === 1,
    );
    expect(updatedMetric).toMatchObject({
      permit: { released: 1 },
      adaptive: { restartConservative: 1 },
    });
  });

  it("资源池快照使用同一观测 seam，并拒绝无效交易日或非整数用量", async () => {
    const runtime = service();
    await runtime.recordResourceSnapshot({
      idempotencyKey: "resource-snapshot",
      resourcePool: "deepseek",
      observedAt: new Date(100),
      tradingDate: "2026-08-03",
      circuit: { state: "CLOSED" },
      permit: { state: "ACQUIRED", waitMs: 3 },
      usage: { requests: 1 },
      adaptive: {
        previous: 8,
        current: 4,
        hardLimit: 8,
        reason: "RATE_LIMITED_HALVED",
        cooldownUntil: new Date(300_100),
      },
    });
    const [resourceMetric] = await runtime.query({ resourcePool: "deepseek" });
    expect(resourceMetric?.adaptive).toMatchObject({
      samples: 1,
      decreased: 1,
      rateLimitedHalves: 1,
      cooldownSamples: 1,
      maxCurrentConcurrency: 4,
      hardLimit: 8,
    });
    await expect(
      runtime.record({
        idempotencyKey: "bad-date",
        readyAt: new Date(100),
        tradingDate: "2026/08/03",
      }),
    ).rejects.toThrow(/交易日/);
    await expect(
      runtime.record({
        idempotencyKey: "bad-usage",
        readyAt: new Date(100),
        usage: { requests: 0.5 },
      }),
    ).rejects.toThrow(/非负整数/);
  });

  it("许可不可用和熔断阻断会形成严重告警，不允许绕过资源门控", async () => {
    const runtime = service();
    const result = await runtime.recordResourceSnapshot({
      idempotencyKey: "resource-blocked",
      resourcePool: "tushare",
      observedAt: new Date(100),
      permit: { state: "UNAVAILABLE" },
      circuit: { state: "OPEN" },
    });

    expect(result.breaches.map((item) => item.kind)).toEqual([
      "PERMIT",
      "CIRCUIT",
    ]);
    expect(result.alerts.map((item) => item.thresholdPercent)).toEqual([100, 100]);
  });
});
