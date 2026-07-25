import { describe, expect, it, vi } from "vitest";
import { EvidenceAwareLlmClient } from "~/server/application/evidence-context/evidence-aware-llm-client";

describe("EvidenceAwareLlmClient", () => {
  it("证据约束调用会持久化快照并仅用快照 item 创建主张", async () => {
    const repository = {
      listItemsForUser: vi.fn(async () => [
        {
          item: {
            id: "evidence-1",
            itemKey: "fact",
            status: "available",
            sourceType: "test",
            extractedFact: "可核验事实",
            warnings: [],
            limitations: [],
            metadata: {},
            recordKind: "observation",
            lineageId: "lineage-1",
            derivedFromItemIds: [],
            contentHash: "hash-1",
          },
        },
      ]),
      createSnapshot: vi.fn(async () => ({ id: "snapshot-1" })),
      markSnapshot: vi.fn(async () => undefined),
      createClaims: vi.fn(async () => []),
    };
    const model = { complete: vi.fn(async () => "生成结论") };
    const client = new EvidenceAwareLlmClient(model as never, repository as never);

    const result = await client.complete({
      userId: "user-1",
      purpose: "report",
      policy: "evidence_required",
      messages: [{ role: "user", content: "分析" }],
      evidenceItemIds: ["evidence-1"],
      fallbackText: "降级结论",
    });

    expect(result.snapshotId).toBe("snapshot-1");
    expect(repository.createClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "snapshot-1",
        claims: [
          expect.objectContaining({
            citations: [{ evidenceItemId: "evidence-1", relation: "support" }],
          }),
        ],
      }),
    );
  });
});
