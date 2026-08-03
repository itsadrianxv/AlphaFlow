import type {
  ResearchRadarItem,
  ResearchRadarResult,
} from "~/contracts/research-radar";

export type ResearchRadarPreference = {
  id: string;
  contentHash: string;
};

export type ResearchRadarCandidate = Omit<ResearchRadarItem, "baselineRank"> & {
  globalRank: number;
};

export interface ResearchRadarRepository {
  listCandidates(input: { userId: string }): Promise<{
    preferenceSnapshot: ResearchRadarPreference | null;
    candidates: ResearchRadarCandidate[];
  }>;
}

export class ResearchRadarService {
  constructor(
    private readonly repository: ResearchRadarRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async query(userId: string, capacity = 20): Promise<ResearchRadarResult> {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      throw new Error("研究雷达容量必须位于 1 到 100 之间");
    }
    const result = await this.repository.listCandidates({ userId });
    const ranked = [...result.candidates]
      .filter(
        (candidate) =>
          candidate.relevance !== null &&
          candidate.relevance > 0 &&
          candidate.matchedPreferences.length > 0,
      )
      .sort(compareCandidates);
    return {
      userId,
      preferenceSnapshotId: result.preferenceSnapshot?.id ?? null,
      preferenceContentHash: result.preferenceSnapshot?.contentHash ?? null,
      capacity,
      candidateCount: ranked.length,
      items: ranked.slice(0, capacity).map(({ globalRank, ...candidate }) => ({
        ...candidate,
        baselineRank: globalRank,
      })),
      generatedAt: this.clock().toISOString(),
    };
  }
}

function compareCandidates(
  left: ResearchRadarCandidate,
  right: ResearchRadarCandidate,
) {
  if (left.directFocusMatch !== right.directFocusMatch) {
    return left.directFocusMatch ? -1 : 1;
  }
  const relevance = (right.relevance ?? -1) - (left.relevance ?? -1);
  if (relevance !== 0) return relevance;
  const importance =
    (right.globalScores.importance ?? -1) -
    (left.globalScores.importance ?? -1);
  if (importance !== 0) return importance;
  const confidence =
    (right.globalScores.confidence ?? -1) -
    (left.globalScores.confidence ?? -1);
  if (confidence !== 0) return confidence;
  return left.eventRevisionId.localeCompare(right.eventRevisionId);
}
