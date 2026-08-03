import type { PrismaClient } from "@prisma/client";
import type {
  ResearchRadarCandidate,
  ResearchRadarPreference,
  ResearchRadarRepository,
} from "~/server/application/research-radar/research-radar-service";

export class PrismaResearchRadarRepository implements ResearchRadarRepository {
  constructor(private readonly db: PrismaClient) {}

  async listCandidates(input: { userId: string }) {
    const snapshot = await this.db.researchPreferenceSnapshot.findFirst({
      where: { userId: input.userId, personalDataDeletedAt: null },
      orderBy: [{ frozenAt: "desc" }, { id: "desc" }],
      select: { id: true, contentHash: true },
    });
    if (!snapshot) {
      return {
        preferenceSnapshot: null,
        candidates: [],
      };
    }

    const events = await this.db.researchEvent.findMany({
      where: { currentRevisionId: { not: null } },
      include: {
        currentRevision: {
          include: {
            globalAssessment: true,
            relevanceAssessments: {
              where: {
                userId: input.userId,
                preferenceSnapshotId: snapshot.id,
                personalDataDeletedAt: null,
              },
              take: 1,
            },
            claims: { select: { id: true } },
          },
        },
      },
    });

    const globallyRanked = events
      .flatMap((event) => {
        const revision = event.currentRevision;
        if (!revision) return [];
        return [
          {
            event,
            revision,
            globalRankCandidate: mapGlobalRankCandidate(event, revision),
          },
        ];
      })
      .sort((left, right) =>
        compareGlobalRank(left.globalRankCandidate, right.globalRankCandidate),
      )
      .map((item, index) => ({ ...item, globalRank: index + 1 }));

    const candidates = globallyRanked.flatMap((event) => {
      const relevance = event.revision.relevanceAssessments[0];
      if (!relevance) return [];
      return [
        {
          ...mapCandidate({
            event: event.event,
            revision: event.revision,
            relevance,
            global: event.revision.globalAssessment,
          }),
          globalRank: event.globalRank,
        },
      ];
    });

    return {
      preferenceSnapshot: mapPreferenceSnapshot(snapshot),
      candidates,
    };
  }
}

function mapGlobalRankCandidate(
  event: { id: string; subjectType: string; subjectKey: string },
  revision: {
    id: string;
    title: string;
    summary: string;
    revisionKind: string;
    occurredAt: Date;
    claims: Array<{ id: string }>;
    globalAssessment: {
      dimensionsJson: unknown;
      importance: number | null;
      confidence: number | null;
      informationNovelty: number | null;
    } | null;
  },
) {
  return mapCandidate({
    event,
    revision,
    relevance: {
      relevance: null,
      directFocusMatch: false,
      matchedPreferencesJson: [],
      dimensionJson: {},
    },
    global: revision.globalAssessment,
  });
}

function mapPreferenceSnapshot(row: {
  id: string;
  contentHash: string;
}): ResearchRadarPreference {
  return row;
}

function mapCandidate(input: {
  event: {
    id: string;
    subjectType: string;
    subjectKey: string;
  };
  revision: {
    id: string;
    title: string;
    summary: string;
    revisionKind: string;
    occurredAt: Date;
    claims: Array<{ id: string }>;
  };
  relevance: {
    relevance: number | null;
    directFocusMatch: boolean;
    matchedPreferencesJson: unknown;
    dimensionJson: unknown;
  };
  global: {
    dimensionsJson: unknown;
    importance: number | null;
    confidence: number | null;
    informationNovelty: number | null;
  } | null;
}): ResearchRadarCandidate {
  const relevanceDimension = asRecord(input.relevance.dimensionJson);
  const globalDimension = asRecord(input.global?.dimensionsJson);
  return {
    eventRevisionId: input.revision.id,
    eventId: input.event.id,
    title: input.revision.title,
    summary: input.revision.summary,
    subjectType: input.event.subjectType,
    subjectKey: input.event.subjectKey,
    revisionKind: input.revision.revisionKind,
    occurredAt: input.revision.occurredAt.toISOString(),
    relevance: input.relevance.relevance as ResearchRadarCandidate["relevance"],
    relevanceReason: reasonFromDimension(relevanceDimension),
    matchedPreferences: preferenceMatches(
      input.relevance.matchedPreferencesJson,
    ),
    directFocusMatch: input.relevance.directFocusMatch,
    globalScores: {
      importance: score(input.global?.importance ?? globalDimension.importance),
      confidence: score(input.global?.confidence ?? globalDimension.confidence),
      informationNovelty: score(
        input.global?.informationNovelty ?? globalDimension.informationNovelty,
      ),
    },
    evidenceCount: input.revision.claims.length,
    globalRank: 0,
  };
}

function compareGlobalRank(
  left: ResearchRadarCandidate,
  right: ResearchRadarCandidate,
) {
  const importance =
    (right.globalScores.importance ?? -1) -
    (left.globalScores.importance ?? -1);
  if (importance !== 0) return importance;
  const novelty =
    (right.globalScores.informationNovelty ?? -1) -
    (left.globalScores.informationNovelty ?? -1);
  if (novelty !== 0) return novelty;
  const occurred = right.occurredAt.localeCompare(left.occurredAt);
  if (occurred !== 0) return occurred;
  return left.eventRevisionId.localeCompare(right.eventRevisionId);
}

function preferenceMatches(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (
      typeof record.targetType !== "string" ||
      typeof record.targetKey !== "string" ||
      typeof record.level !== "string" ||
      (record.relation !== "DIRECT" && record.relation !== "WEAK")
    ) {
      return [];
    }
    const relation: "DIRECT" | "WEAK" =
      record.relation === "DIRECT" ? "DIRECT" : "WEAK";
    return [
      {
        targetType: record.targetType,
        targetKey: record.targetKey,
        level: record.level,
        relation,
        ...(Array.isArray(record.path)
          ? {
              path: record.path.filter(
                (part): part is string => typeof part === "string",
              ),
            }
          : {}),
      },
    ];
  });
}

function reasonFromDimension(value: Record<string, unknown>) {
  const reasons = Array.isArray(value.reasons) ? value.reasons : [];
  const first = asRecord(reasons[0]);
  return typeof first.text === "string" && first.text.trim()
    ? first.text
    : "用户偏好命中";
}

function score(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 4
    ? (value as 0 | 1 | 2 | 3 | 4)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
