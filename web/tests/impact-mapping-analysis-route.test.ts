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
      payload: { impactMapping: baseResult(true) },
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
});
