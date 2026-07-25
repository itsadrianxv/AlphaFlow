import { describe, expect, it } from "vitest";
import {
  buildEvidenceContextView,
  sanitizeEvidenceRawValue,
  type EvidenceContext,
} from "~/server/domain/evidence-context/types";
import { appendEvidenceItem } from "~/server/application/evidence-context/evidence-context-writer";
import { evidenceContextDetailSchema } from "~/contracts/evidence-context";
import { PrismaEvidenceContextRepository } from "~/server/infrastructure/evidence-context/prisma-evidence-context-repository";

function context(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    id: "context-1",
    userId: "user-1",
    subject: { subjectType: "stock", subjectId: "000001", label: "平安银行" },
    blocks: [
      {
        id: "block-1",
        blockKey: "technical",
        status: "available",
        items: [
          {
            id: "item-1",
            itemKey: "rsi",
            status: "available",
            sourceType: "timing_signal_snapshot",
            extractedFact: "RSI 为 48",
            observedAt: "2026-07-21T00:00:00.000Z",
            warnings: [],
            limitations: [],
            metadata: {},
            recordKind: "observation",
            lineageId: "lineage-1",
            derivedFromItemIds: [],
            contentHash: "test-hash",
          },
        ],
        warnings: [],
        limitations: [],
        metadata: {},
      },
    ],
    createdAt: "2026-07-21T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("EvidenceContext", () => {
  it("按 freshness policy 将旧事实降级为 stale 并限制置信度", () => {
    const view = buildEvidenceContextView({
      contexts: [context()],
      now: new Date("2026-07-24T00:00:00.000Z"),
      policy: {
        freshnessWindows: [{ blockKey: "technical", maxAgeDays: 1 }],
      },
    });

    expect(view.blocks[0]?.effectiveStatus).toBe("stale");
    expect(view.quality.confidenceCap).toBe("medium");
    expect(view.quality.level).toBe("limited");
  });

  it("合并多个上下文时保留 item 并标记状态冲突", () => {
    const second = context({
      id: "context-2",
      blocks: [
        {
          ...context().blocks[0]!,
          id: "block-2",
          status: "fetch_failed",
          items: [],
        },
      ],
    });
    const view = buildEvidenceContextView({ contexts: [context(), second] });

    expect(view.blocks[0]?.items).toHaveLength(1);
    expect(view.blocks[0]?.warnings).toContain("conflicting_context_statuses");
  });

  it("递归脱敏敏感字段并限制循环结构", () => {
    const value: Record<string, unknown> = {
      token: "secret",
      nested: { api_key: "key", visible: 1 },
    };
    value.self = value;

    expect(sanitizeEvidenceRawValue(value)).toEqual({
      token: "[REDACTED]",
      nested: { api_key: "[REDACTED]", visible: 1 },
      self: "[Circular]",
    });
  });

  it("派生与修正通过新增 item 保留血缘，不修改旧证据", async () => {
    let received: Record<string, unknown> | undefined;
    await appendEvidenceItem({
      writer: {
        appendItem: async (params: unknown) => {
          received = params as Record<string, unknown>;
          return params;
        },
      } as never,
      userId: "user-1",
      contextId: "context-1",
      blockId: "block-1",
      item: {
        itemKey: "derived-rsi",
        status: "available",
        sourceType: "calculator",
        warnings: [],
        limitations: [],
        metadata: {},
        recordKind: "derived",
        derivedFromItemIds: ["raw-bars-1"],
        algorithmVersion: "indicator-v1",
      },
    });

    const appended = received?.item as { lineageId: string; contentHash: string; derivedFromItemIds: string[] };
    expect(appended.lineageId).toBeTruthy();
    expect(appended.contentHash).toHaveLength(64);
    expect(appended.derivedFromItemIds).toEqual(["raw-bars-1"]);
  });

  it("血缘详情为内嵌证据项保留数据块键", async () => {
    const record = {
      id: "item-1",
      itemKey: "rsi",
      status: "available",
      extractedFact: "RSI 为 48",
      snippet: null,
      valueJson: null,
      rawValueJson: null,
      sourceType: "timing_signal_snapshot",
      sourceId: null,
      sourceName: null,
      sourceUrl: null,
      publishedAt: null,
      observedAt: new Date("2026-07-21T00:00:00.000Z"),
      fetchedAt: null,
      fallbackFrom: null,
      missingReason: null,
      warnings: [],
      limitations: [],
      metadataJson: {},
      recordKind: "observation",
      lineageId: "lineage-1",
      derivedFromItemIds: [],
      algorithmVersion: null,
      parametersJson: null,
      correctionOfItemId: null,
      supersedesItemId: null,
      contentHash: "test-hash",
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      context: {
        id: "context-1",
        subjectType: "stock",
        subjectId: "000001",
        subjectLabel: "平安银行",
        phase: null,
      },
      block: { blockKey: "technical" },
    };
    const repository = new PrismaEvidenceContextRepository({
      evidenceContextItem: {
        findFirst: async () => ({ lineageId: "lineage-1" }),
        findMany: async () => [record],
      },
    } as never);

    const lineage = await repository.getLineageForUser("user-1", "item-1");

    expect(lineage[0]?.item.blockKey).toBe("technical");
    expect(() => evidenceContextDetailSchema.parse(lineage[0])).not.toThrow();
  });
});
