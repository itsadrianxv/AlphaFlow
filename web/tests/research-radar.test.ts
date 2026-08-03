import { describe, expect, it } from "vitest";
import { ResearchRadarService } from "~/server/application/research-radar/research-radar-service";

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    eventRevisionId: id,
    eventId: `event-${id}`,
    title: id,
    summary: `${id} summary`,
    subjectType: "COMPANY",
    subjectKey: id,
    revisionKind: "CONFIRMED",
    occurredAt: "2026-08-03T02:00:00.000Z",
    relevance: 3 as const,
    relevanceReason: "关注命中",
    matchedPreferences: [
      {
        targetType: "COMPANY",
        targetKey: id,
        level: "FOCUS",
        relation: "DIRECT" as const,
      },
    ],
    directFocusMatch: true,
    globalScores: { importance: 3 as const, confidence: 3 as const, informationNovelty: 3 as const },
    evidenceCount: 1,
    globalRank: 1,
    ...overrides,
  };
}

describe("ResearchRadarService", () => {
  it("先从全量候选选择用户直接命中的事件，再应用容量", async () => {
    const service = new ResearchRadarService(
      {
        async listCandidates() {
          return {
            preferenceSnapshot: { id: "snapshot-1", contentHash: "sha256:one" },
            candidates: [
              candidate("baseline-1", { directFocusMatch: false, matchedPreferences: [{ targetType: "COMPANY", targetKey: "baseline-1", level: "REGULAR", relation: "WEAK" }] }),
              candidate("baseline-2", { directFocusMatch: false, matchedPreferences: [{ targetType: "COMPANY", targetKey: "baseline-2", level: "REGULAR", relation: "WEAK" }] }),
              candidate("focus-outside-baseline", { globalRank: 99 }),
            ],
          };
        },
      },
      () => new Date("2026-08-03T03:00:00.000Z"),
    );

    const result = await service.query("user-1", 1);

    expect(result.candidateCount).toBe(3);
    expect(result.items.map((item) => item.eventRevisionId)).toEqual([
      "focus-outside-baseline",
    ]);
    expect(result.items[0]?.baselineRank).toBe(99);
    expect(result.preferenceSnapshotId).toBe("snapshot-1");
  });

  it("隔离用户且拒绝越界容量", async () => {
    const calls: string[] = [];
    const service = new ResearchRadarService({
      async listCandidates(input) {
        calls.push(input.userId);
        return { preferenceSnapshot: null, candidates: [] };
      },
    });

    await expect(service.query("user-a", 0)).rejects.toThrow("容量");
    await service.query("user-b", 20);
    expect(calls).toEqual(["user-b"]);
  });
});
