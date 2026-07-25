import { describe, expect, it } from "vitest";
import { ResearchContextBuilder } from "~/server/application/evidence-context/research-context-builder";
import type { EvidenceContextItem } from "~/server/domain/evidence-context/types";

function item(overrides: Partial<EvidenceContextItem> = {}): EvidenceContextItem {
  return {
    id: "evidence-1",
    itemKey: "fact",
    status: "available",
    sourceType: "test",
    extractedFact: "这是一条可审计的事实。",
    warnings: [],
    limitations: [],
    metadata: {},
    recordKind: "observation",
    lineageId: "lineage-1",
    derivedFromItemIds: [],
    contentHash: "hash-1",
    ...overrides,
  };
}

describe("ResearchContextBuilder", () => {
  it("只投影用户可访问的证据，并将质量限制写入 prompt", async () => {
    const repository = {
      listItemsForUser: async () => [
        {
          id: "evidence-1",
          contextId: "context-1",
          subjectType: "stock",
          subjectId: "000001",
          blockKey: "technical",
          item: item({ status: "partial", limitations: ["数据不完整"] }),
          createdAt: "2026-07-24T00:00:00.000Z",
        },
      ],
    };
    const builder = new ResearchContextBuilder(repository as never);
    const result = await builder.build({
      userId: "user-1",
      purpose: "test",
      policy: "evidence_required",
      messages: [{ role: "user", content: "请分析" }],
      evidenceItemIds: ["evidence-1"],
    });

    expect(result.items[0]?.evidenceItemId).toBe("evidence-1");
    expect(result.quality.confidenceCap).toBe("low");
    expect(result.messages.at(-1)?.content).toContain("只能基于以下证据");
  });
});
