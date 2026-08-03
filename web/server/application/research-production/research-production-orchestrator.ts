import { createHash } from "node:crypto";
import type { ResearchProductionInput } from "~/contracts/research-production";
import type {
  FrozenResearchEventRevisionInput,
  ResearchAssessmentService,
  SavedGlobalAssessment,
  SavedRelevanceAssessment,
} from "~/server/application/research-assessment/research-assessment-service";
import type { ResearchDistributionService } from "~/server/application/research-distribution/research-distribution-service";
import type { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import type { ResearchInboxBody } from "~/server/domain/research-inbox/types";

export type SettledResearchEvidence =
  FrozenResearchEventRevisionInput["evidence"][number] & {
    evidenceKey: string;
    evidenceRole: string;
    sourceIdentityStatus: string;
    proofQualification: string;
    independenceKey: string;
    citation: Record<string, unknown>;
  };

export type FrozenResearchEventRevision = Omit<
  FrozenResearchEventRevisionInput,
  "evidence"
> & {
  eventId: string;
  candidateId: string;
  revisionKind: string;
  subject: { type: string; key: string };
  occurredAt: string;
  createdAt: string;
  narrative: {
    impact: string;
    reasons: string[];
    nextChecks: string[];
    risks: string[];
  };
  evidence: SettledResearchEvidence[];
};

export type ResearchProductionSettlement = {
  replayed: boolean;
  outcome: "PROMOTE" | "DEFER" | "REJECT" | "TECHNICAL_HOLD";
  candidateId: string;
  revision: FrozenResearchEventRevision | null;
};

export interface ResearchProductionRepository {
  settle(input: ResearchProductionInput): Promise<ResearchProductionSettlement>;
  listDistributionUserIds(): Promise<string[]>;
}

export type ResearchProductionResult = {
  status: "COMPLETED" | "REPLAYED" | "DEFERRED" | "REJECTED" | "TECHNICAL_HOLD";
  candidateId: string;
  eventRevisionId: string | null;
  globalAssessmentId: string | null;
  distributions: Array<{
    userId: string;
    entryId: string;
    highestChannel: "IN_APP" | "BRIEFING" | "URGENT_ALERT";
    created: boolean;
  }>;
};

export type ResearchProductionStageObservation = {
  idempotencyKey: string;
  phase: "STARTED" | "COMPLETED" | "FAILED";
  stage:
    | "event-production"
    | "global-assessment"
    | "relevance-assessment"
    | "in-app-distribution";
  inputContractVersion: string;
  inputHash: string;
  authoritativeObjectIds: string[];
  errorClass?: string;
};

export interface ResearchProductionStageObserver {
  record(input: ResearchProductionStageObservation): Promise<void>;
}

const noOpObserver: ResearchProductionStageObserver = {
  async record() {},
};

/**
 * 已结算候选进入权威研究对象和站内分发的唯一 application seam。
 * 调用方只提交冻结证据与结构化语义裁定，不参与事务、评估缓存或渠道选择。
 */
export class ResearchProductionOrchestrator {
  constructor(
    private readonly repository: ResearchProductionRepository,
    private readonly assessments: ResearchAssessmentService,
    private readonly preferences: ResearchPreferenceService,
    private readonly distribution: ResearchDistributionService,
    private readonly observer: ResearchProductionStageObserver = noOpObserver,
  ) {}

  async process(
    input: ResearchProductionInput,
  ): Promise<ResearchProductionResult> {
    const inputHash = hashJson(input);
    const observe = <T>(
      stage: ResearchProductionStageObservation["stage"],
      suffix: string,
      action: () => Promise<T>,
      objectIds: (result: T) => string[],
    ) => this.observeStage(input, inputHash, stage, suffix, action, objectIds);
    const settlement = await observe(
      "event-production",
      "",
      () => this.repository.settle(input),
      (result) => [
        result.candidateId,
        ...(result.revision ? [result.revision.revisionId] : []),
      ],
    );
    return this.publishSettlement(input, inputHash, settlement);
  }

  async publishRevision(input: {
    idempotencyKey: string;
    contractVersion: string;
    inputHash: string;
    revision: FrozenResearchEventRevision;
  }) {
    const settlement: ResearchProductionSettlement = {
      replayed: false,
      outcome: "PROMOTE",
      candidateId: input.revision.candidateId,
      revision: input.revision,
    };
    await this.observer.record({
      idempotencyKey: `${input.idempotencyKey}:event-production`,
      phase: "COMPLETED",
      stage: "event-production",
      inputContractVersion: input.contractVersion,
      inputHash: input.inputHash,
      authoritativeObjectIds: [input.revision.revisionId],
    });
    return this.publishSettlement(input, input.inputHash, settlement);
  }

  private async publishSettlement(
    input: { idempotencyKey: string; contractVersion: string },
    inputHash: string,
    settlement: ResearchProductionSettlement,
  ): Promise<ResearchProductionResult> {
    const observe = <T>(
      stage: ResearchProductionStageObservation["stage"],
      suffix: string,
      action: () => Promise<T>,
      objectIds: (result: T) => string[],
    ) => this.observeStage(input, inputHash, stage, suffix, action, objectIds);
    if (!settlement.revision) {
      return {
        status: terminalStatus(settlement.outcome),
        candidateId: settlement.candidateId,
        eventRevisionId: null,
        globalAssessmentId: null,
        distributions: [],
      };
    }
    const revision = settlement.revision;

    const global = await observe(
      "global-assessment",
      "",
      () => this.assessments.assessGlobal(revision),
      (result) => [revision.revisionId, result.assessment.id],
    );
    const userIds = await this.repository.listDistributionUserIds();
    const distributions: ResearchProductionResult["distributions"] = [];
    for (const userId of userIds) {
      const preferenceSnapshot = await this.preferences.freeze(userId);
      const relevance = await observe(
        "relevance-assessment",
        userId,
        () =>
          this.assessments.assessRelevance({
            userId,
            eventRevision: revision,
            preferenceSnapshot,
          }),
        (result) => [
          revision.revisionId,
          result.assessment.id,
          preferenceSnapshot.id,
        ],
      );
      const distributed = await observe(
        "in-app-distribution",
        userId,
        () =>
          this.distribution.distribute({
            distributionKey: `research:${revision.revisionId}:${userId}`,
            userId,
            subject: {
              kind: "EVENT_REVISION",
              id: revision.revisionId,
            },
            revisionKind: revisionKind(revision.revisionKind),
            title: revision.title,
            summary: revision.summary,
            body: buildInboxBody(
              revision,
              global.assessment,
              relevance.assessment,
            ),
            scores: {
              importance: global.assessment.output.importance.score,
              confidence: global.assessment.output.confidence.score,
              relevance: relevance.assessment.output.relevance.score,
              informationNovelty:
                global.assessment.output.informationNovelty.score,
            },
            directPreferenceMatch: relevance.assessment.matchedPreferences.some(
              (item) => item.relation === "DIRECT",
            ),
            directFocusMatch: relevance.assessment.directFocusMatch,
            preferenceSnapshot,
            sourceIdentityVerified: revision.evidence.some(
              (item) => item.sourceIdentityStatus === "VERIFIED",
            ),
            coreFactEvidenceQualified: revision.evidence.some(
              (item) =>
                item.evidenceRole === "CORE_FACT" &&
                item.proofQualification === "QUALIFIED",
            ),
            anomalyOnly: revision.evidence.every(
              (item) => item.evidenceRole !== "CORE_FACT",
            ),
            globalAssessmentId: global.assessment.id,
            relevanceAssessmentId: relevance.assessment.id,
          }),
        (result) => [revision.revisionId, result.entry.id],
      );
      distributions.push({
        userId,
        entryId: distributed.entry.id,
        highestChannel: distributed.decision.highestChannel,
        created: distributed.created,
      });
    }
    return {
      status: settlement.replayed ? "REPLAYED" : "COMPLETED",
      candidateId: settlement.candidateId,
      eventRevisionId: revision.revisionId,
      globalAssessmentId: global.assessment.id,
      distributions,
    };
  }

  private async observeStage<T>(
    input: { idempotencyKey: string; contractVersion: string },
    inputHash: string,
    stage: ResearchProductionStageObservation["stage"],
    suffix: string,
    action: () => Promise<T>,
    objectIds: (result: T) => string[],
  ) {
    const stageKey = `${input.idempotencyKey}:${stage}${suffix ? `:${suffix}` : ""}`;
    await this.observer.record({
      idempotencyKey: stageKey,
      phase: "STARTED",
      stage,
      inputContractVersion: input.contractVersion,
      inputHash,
      authoritativeObjectIds: [],
    });
    try {
      const result = await action();
      await this.observer.record({
        idempotencyKey: stageKey,
        phase: "COMPLETED",
        stage,
        inputContractVersion: input.contractVersion,
        inputHash,
        authoritativeObjectIds: objectIds(result),
      });
      return result;
    } catch (error) {
      await this.observer.record({
        idempotencyKey: stageKey,
        phase: "FAILED",
        stage,
        inputContractVersion: input.contractVersion,
        inputHash,
        authoritativeObjectIds: [],
        errorClass: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      });
      throw error;
    }
  }
}

function hashJson(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildInboxBody(
  revision: FrozenResearchEventRevision,
  global: SavedGlobalAssessment,
  relevance: SavedRelevanceAssessment,
): ResearchInboxBody {
  return {
    subject: {
      type: revision.subject.type,
      key: revision.subject.key,
      label: revision.subject.key,
    },
    eventStatus: revision.revisionKind,
    occurredAt: revision.occurredAt,
    facts: revision.claims.map((claim) => claim.text),
    impact: revision.narrative.impact,
    reasons: revision.narrative.reasons,
    nextChecks: revision.narrative.nextChecks,
    risks: revision.narrative.risks,
    assessments: {
      importance: assessmentText(global.output.importance),
      confidence: assessmentText(global.output.confidence),
      relevance: assessmentText(relevance.output.relevance),
      informationNovelty: assessmentText(global.output.informationNovelty),
    },
    evidence: revision.evidence.map((item) => ({
      id: item.evidenceKey,
      source: stringField(item.citation, "source", "权威研究证据"),
      excerpt: stringField(item.citation, "excerpt", item.summary),
      qualification: item.proofQualification,
      ...(optionalHref(item.citation.href)
        ? { href: optionalHref(item.citation.href) }
        : {}),
    })),
    revisions: [
      {
        id: revision.revisionId,
        kind: revision.revisionKind,
        label: "首次生成",
        summary: revision.summary,
        createdAt: revision.createdAt,
      },
    ],
    aiDisclosure: "AI 生成研究解释，仅依据所列冻结证据。",
    externalCopyStatus: "外部副本按确定性投递状态单独结算",
  };
}

function assessmentText(input: {
  score: 0 | 1 | 2 | 3 | 4 | null;
  reasons: Array<{ text: string }>;
}) {
  return {
    level: scoreLevel(input.score),
    reason: input.reasons[0]?.text ?? "无法判断",
  };
}

function scoreLevel(score: 0 | 1 | 2 | 3 | 4 | null) {
  if (score === null) return "无法判断";
  if (score <= 1) return "低";
  if (score === 2) return "中";
  if (score === 3) return "高";
  return "极高";
}

function terminalStatus(outcome: ResearchProductionSettlement["outcome"]) {
  const statuses = {
    PROMOTE: "COMPLETED",
    DEFER: "DEFERRED",
    REJECT: "REJECTED",
    TECHNICAL_HOLD: "TECHNICAL_HOLD",
  } as const;
  return statuses[outcome];
}

function revisionKind(value: string) {
  if (value === "CORRECTED") return "CORRECTION" as const;
  if (value === "RETRACTED") return "RETRACTION" as const;
  return "EVENT" as const;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  fallback: string,
) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalHref(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : undefined;
}
