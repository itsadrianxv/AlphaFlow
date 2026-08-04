import { WorkflowRunStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

const createCaller = createCallerFactory(workflowRouter);
const baseRunId = "clx1234567890123456789012";

function baseResult(withAnalysis: boolean) {
  return {
    mode: "overview",
    analysisStatus: "complete",
    asOf: "2026-07-25T08:00:00.000Z",
    context: { watchLists: [], companies: [], industries: [], hypotheses: [] },
    events: [
      {
        event: {
          id: "event-1",
          title: "测试新闻",
          summary: "测试摘要",
          source: "测试来源",
          publishedAt: "2026-07-25T07:00:00.000Z",
          sentiment: "neutral",
          relevanceScore: 0.8,
          relatedStocks: [],
          scopeTags: ["macro"],
          eventType: "macro",
          matchReason: "测试",
        },
        impactEdges: [],
        portfolioHits: [],
        importanceScore: 80,
        ...(withAnalysis
          ? {
              analysis: {
                timeline: [],
                scenarios: [],
                warnings: [],
              },
            }
          : {}),
      },
    ],
    impactEdges: [],
    timeline: [],
    scenarios: [],
    evidenceCitations: [],
    warnings: [],
  };
}

function callerWithFindFirst(findFirst: ReturnType<typeof vi.fn>) {
  return createCaller({
    db: {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          sessionVersion: 0,
          status: "ACTIVE",
        })),
      },
      workflowRun: { findFirst },
    },
    session: {
      user: { id: "user-1", sessionVersion: 0 },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
  } as never);
}

function callerForPausedRun(params: {
  pauseReason: string;
  idempotencyKey: string;
  createError?: unknown;
  concurrentRun?: {
    id: string;
    status: WorkflowRunStatus;
    createdAt: Date;
  };
}) {
  const create = params.createError
    ? vi.fn(async () => Promise.reject(params.createError))
    : vi.fn(async () => ({
        id: "run-retry-1",
        status: WorkflowRunStatus.PENDING,
        createdAt: new Date("2026-07-25T08:00:00.000Z"),
      }));
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce({
      input: { mode: "overview" },
      result: baseResult(false),
    })
    .mockResolvedValueOnce({
      id: "run-paused-1",
      idempotencyKey: params.idempotencyKey,
      status: WorkflowRunStatus.PAUSED,
      result: null,
      events: [
        {
          eventType: "RUN_PAUSED",
          payload: { reason: params.pauseReason },
        },
      ],
    })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(params.concurrentRun ?? null);
  const db = {
    user: {
      findUnique: vi.fn(async () => ({
        id: "user-1",
        sessionVersion: 0,
        status: "ACTIVE",
      })),
    },
    workflowRun: {
      findFirst,
      create,
      update: vi.fn(async () => undefined),
    },
    workflowTemplate: {
      findFirst: vi.fn(async () => ({
        id: "template-1",
        version: 1,
        graphConfig: {
          nodes: [
            "load_impact_context",
            "collect_impact_evidence",
            "persist_impact_observations",
            "map_impact_layers",
            "build_impact_timeline",
            "forecast_impact_scenarios",
            "persist_impact_analysis",
          ],
        },
      })),
    },
    workflowNodeRun: { createMany: vi.fn(async () => undefined) },
    workflowEvent: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(db),
    ),
  };

  return {
    caller: createCaller({
      db,
      session: {
        user: { id: "user-1", sessionVersion: 0 },
        expires: "2099-01-01T00:00:00.000Z",
      },
      headers: new Headers(),
    } as never),
    create,
  };
}

function callerWithSnapshot(snapshot: unknown) {
  return createCaller({
    db: {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          sessionVersion: 0,
          status: "ACTIVE",
        })),
      },
      workflowRun: { findFirst: vi.fn() },
      homepageSnapshot: { findFirst: vi.fn(async () => snapshot) },
    },
    session: {
      user: { id: "user-1", sessionVersion: 0 },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
  } as never);
}

describe("ensureImpactMappingAnalyses", () => {
  it("直接复用 overview 内嵌分析", async () => {
    const findFirst = vi.fn(async () => ({
      input: { mode: "overview" },
      result: baseResult(true),
    }));
    const result = await callerWithFindFirst(findFirst).ensureImpactMappingAnalyses(
      { baseRunId, eventIds: ["event-1"] },
    );

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      status: WorkflowRunStatus.SUCCEEDED,
      source: "base",
      result: { mode: "trace", selectedEvent: { id: "event-1" } },
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("允许基于首页快照中的事件复用内嵌分析", async () => {
    const baseSnapshotId = "cly1234567890123456789012";
    const result = await callerWithSnapshot({
      payloadJson: { impactMapping: baseResult(true) },
    }).ensureImpactMappingAnalyses({
      baseSnapshotId,
      eventIds: ["event-1"],
    });

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      status: WorkflowRunStatus.SUCCEEDED,
      source: "base",
      result: { selectedEvent: { id: "event-1" } },
    });
  });

  it("复用已完成的事件 trace 运行", async () => {
    const traceResult = {
      ...baseResult(false),
      mode: "trace",
      selectedEvent: baseResult(false).events[0]?.event,
    };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        input: { mode: "overview" },
        result: baseResult(false),
      })
      .mockResolvedValueOnce({
        id: "run-trace-1",
        status: WorkflowRunStatus.SUCCEEDED,
        result: traceResult,
      });
    const result = await callerWithFindFirst(findFirst).ensureImpactMappingAnalyses(
      { baseRunId, eventIds: ["event-1"] },
    );

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      runId: "run-trace-1",
      status: WorkflowRunStatus.SUCCEEDED,
      source: "run",
    });
  });

  it("拒绝基准快照之外的事件", async () => {
    const findFirst = vi.fn(async () => ({
      input: { mode: "overview" },
      result: baseResult(false),
    }));

    await expect(
      callerWithFindFirst(findFirst).ensureImpactMappingAnalyses({
        baseRunId,
        eventIds: ["event-missing"],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "基准快照中不存在新闻事件: event-missing",
    });
  });

  it("节点超时暂停后只创建一次新的分析尝试", async () => {
    const stableKey = `impact-analysis:run:${baseRunId}:event-1`;
    const { caller, create } = callerForPausedRun({
      pauseReason: "node_timeout",
      idempotencyKey: stableKey,
    });

    const result = await caller.ensureImpactMappingAnalyses({
      baseRunId,
      eventIds: ["event-1"],
    });

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      runId: "run-retry-1",
      status: WorkflowRunStatus.PENDING,
      attempt: 2,
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("并发创建第二次尝试冲突时复用已胜出的运行", async () => {
    const stableKey = `impact-analysis:run:${baseRunId}:event-1`;
    const { caller, create } = callerForPausedRun({
      pauseReason: "node_timeout",
      idempotencyKey: stableKey,
      createError: {
        code: "P2002",
        meta: { target: ["userId", "idempotencyKey"] },
      },
      concurrentRun: {
        id: "run-concurrent-winner",
        status: WorkflowRunStatus.PENDING,
        createdAt: new Date("2026-07-25T08:00:00.000Z"),
      },
    });

    const result = await caller.ensureImpactMappingAnalyses({
      baseRunId,
      eventIds: ["event-1"],
    });

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      runId: "run-concurrent-winner",
      status: WorkflowRunStatus.PENDING,
      attempt: 2,
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("第二次节点超时后返回重试耗尽且不再创建运行", async () => {
    const stableKey = `impact-analysis:run:${baseRunId}:event-1`;
    const { caller, create } = callerForPausedRun({
      pauseReason: "node_timeout",
      idempotencyKey: `${stableKey}:attempt:2`,
    });

    const result = await caller.ensureImpactMappingAnalyses({
      baseRunId,
      eventIds: ["event-1"],
    });

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      runId: "run-paused-1",
      status: WorkflowRunStatus.PAUSED,
      pauseReason: "node_timeout",
      retryExhausted: true,
      attempt: 2,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("等待人工输入的暂停运行保持可恢复且不自动重试", async () => {
    const stableKey = `impact-analysis:run:${baseRunId}:event-1`;
    const { caller, create } = callerForPausedRun({
      pauseReason: "waiting_for_input",
      idempotencyKey: stableKey,
    });

    const result = await caller.ensureImpactMappingAnalyses({
      baseRunId,
      eventIds: ["event-1"],
    });

    expect(result[0]).toMatchObject({
      eventId: "event-1",
      runId: "run-paused-1",
      status: WorkflowRunStatus.PAUSED,
      pauseReason: "waiting_for_input",
      retryExhausted: false,
      attempt: 1,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
