import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ResearchProductionInput } from "~/contracts/research-production";
import type {
  FrozenResearchEventRevision,
  ResearchProductionRepository,
  ResearchProductionSettlement,
} from "~/server/application/research-production/research-production-orchestrator";

type TransactionClient = Prisma.TransactionClient;

export class PrismaResearchProductionRepository
  implements ResearchProductionRepository
{
  constructor(private readonly db: PrismaClient) {}

  loadRevision(revisionId: string) {
    return loadRevision(this.db, revisionId);
  }

  async settle(
    input: ResearchProductionInput,
  ): Promise<ResearchProductionSettlement> {
    const inputHash = hashJson({
      candidateKey: input.candidate.candidateKey,
      eventIdentityKey: input.candidate.eventIdentityKey,
      evidence: input.candidate.evidence,
      adjudication: input.adjudication,
    });
    const existing = await this.db.researchEventCandidateDecision.findUnique({
      where: { inputHash },
      select: { candidateId: true, outcome: true },
    });
    if (existing) return this.replayed(existing.candidateId, existing.outcome);

    return this.db.$transaction(
      async (tx) => {
        const raced = await tx.researchEventCandidateDecision.findUnique({
          where: { inputHash },
          select: { candidateId: true, outcome: true },
        });
        if (raced) return this.replayedInTransaction(tx, raced);

        const candidate = await tx.researchEventCandidate.upsert({
          where: { candidateKey: input.candidate.candidateKey },
          create: {
            candidateKey: input.candidate.candidateKey,
            clusterKey: input.candidate.clusterKey,
            subjectType: input.candidate.subjectType,
            subjectKey: input.candidate.subjectKey,
          },
          update: {},
        });
        if (candidate.status !== "OPEN" && candidate.status !== "DEFERRED") {
          throw new Error("已终结研究事件候选不能接收新的裁定");
        }

        const evidence = await this.freezeEvidence(tx, candidate.id, input);
        validatePromotionEvidence(input, evidence);
        const decisionNo =
          (await tx.researchEventCandidateDecision.count({
            where: { candidateId: candidate.id },
          })) + 1;
        const decision = await tx.researchEventCandidateDecision.create({
          data: {
            candidateId: candidate.id,
            decisionNo,
            inputHash,
            contractVersion: input.adjudication.contractVersion,
            model: input.adjudication.model,
            promptVersion: input.adjudication.promptVersion,
            schemaVersion: input.adjudication.schemaVersion,
            outcome: input.adjudication.outcome,
            decisionJson: toJson(input.adjudication),
            evidenceFrozenAt: new Date(),
          },
        });

        if (input.adjudication.outcome !== "PROMOTE") {
          const status = candidateStatus(input.adjudication.outcome);
          await tx.researchEventCandidate.update({
            where: { id: candidate.id },
            data: {
              status,
              currentDecisionId: decision.id,
              evidenceFrozenAt: decision.evidenceFrozenAt,
              observationWindowEndsAt: input.adjudication
                .observationWindowEndsAt
                ? new Date(input.adjudication.observationWindowEndsAt)
                : null,
              nextCheckAt: input.adjudication.nextCheckAt
                ? new Date(input.adjudication.nextCheckAt)
                : null,
              closedAt: status === "REJECTED" ? new Date() : null,
            },
          });
          return {
            replayed: false,
            outcome: input.adjudication.outcome,
            candidateId: candidate.id,
            revision: null,
          };
        }

        const adjudication = requirePromotion(input.adjudication);
        const eventKey = eventKeyFor(input);
        const event = await tx.researchEvent.upsert({
          where: { eventKey },
          create: {
            eventKey,
            canonicalizationVersion: "research-event-identity.v1",
            subjectType: input.candidate.subjectType,
            subjectKey: input.candidate.subjectKey,
          },
          update: {},
        });
        if (event.currentRevisionId) {
          throw new Error("同一事件身份已经存在有效修订，应走事件修订命令");
        }
        const revisionId = randomUUID();
        const revision = await tx.researchEventRevision.create({
          data: {
            id: revisionId,
            eventId: event.id,
            sourceCandidateId: candidate.id,
            revisionNo: 1,
            revisionDedupKey: hashJson({
              eventKey,
              candidateKey: input.candidate.candidateKey,
              decisionInputHash: inputHash,
            }),
            revisionKind: "CONFIRMED",
            title: adjudication.title,
            summary: adjudication.summary,
            narrativeJson: toJson(adjudication.narrative),
            uncertaintyJson: toJson(adjudication.uncertainty),
            counterEvidenceJson: toJson(adjudication.counterEvidence),
            occurredAt: new Date(adjudication.occurredAt),
            knownAt: new Date(adjudication.knownAt),
          },
        });

        const evidenceByKey = new Map(
          evidence.map((item) => [item.evidenceKey, item]),
        );
        for (const [ordinal, claimInput] of adjudication.claims.entries()) {
          const claim = await tx.researchEventClaim.create({
            data: {
              eventRevisionId: revision.id,
              ordinal,
              claimType: claimInput.claimType,
              claimText: claimInput.text,
              isInference: claimInput.isInference,
            },
          });
          for (const evidenceKey of claimInput.evidenceKeys) {
            const citation = evidenceByKey.get(evidenceKey);
            if (!citation) throw new Error("事件事实主张引用未冻结证据");
            await tx.researchEventClaimCitation.create({
              data: {
                claimId: claim.id,
                candidateEvidenceId: citation.id,
                relation: "SUPPORTS",
                sourceIdentityStatus: citation.sourceIdentityStatus,
                proofQualification: citation.proofQualification,
                citationJson: toJson(citation.citation),
              },
            });
          }
        }
        for (const impact of adjudication.impacts) {
          await tx.researchEventImpact.create({
            data: {
              eventRevisionId: revision.id,
              subjectType: impact.subjectType,
              subjectKey: impact.subjectKey,
              impactType: impact.impactType,
              materiality: impact.materiality,
              pathJson: toJson(impact.path),
            },
          });
        }
        await tx.researchEvent.update({
          where: { id: event.id },
          data: { currentRevisionId: revision.id },
        });
        await tx.researchEventCandidate.update({
          where: { id: candidate.id },
          data: {
            status: "PROMOTED",
            currentDecisionId: decision.id,
            evidenceFrozenAt: decision.evidenceFrozenAt,
            closedAt: new Date(),
          },
        });
        await tx.researchAuditRecord.create({
          data: {
            auditKey: `research-production:${input.idempotencyKey}`,
            actorType: "DETERMINISTIC_CONTROLLER",
            action: "RESEARCH_EVENT_PROMOTED",
            entityType: "RESEARCH_EVENT_REVISION",
            entityId: revision.id,
            eventRevisionId: revision.id,
            inputContractVersion: input.contractVersion,
            inputHash,
            resultContractVersion: "research-production-result.v1",
            resultHash: hashJson({ revisionId: revision.id }),
            outcome: "SUCCEEDED",
            detailsJson: toJson({
              candidateId: candidate.id,
              decisionId: decision.id,
            }),
            occurredAt: new Date(),
          },
        });
        return {
          replayed: false,
          outcome: "PROMOTE",
          candidateId: candidate.id,
          revision: await loadRevision(tx, revision.id),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listDistributionUserIds() {
    const preferences = await this.db.researchPreference.findMany({
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    return preferences.map((item) => item.userId);
  }

  private async freezeEvidence(
    tx: TransactionClient,
    candidateId: string,
    input: ResearchProductionInput,
  ) {
    const existing = await tx.researchEventCandidateEvidence.findMany({
      where: { candidateId },
      orderBy: { ordinal: "asc" },
    });
    if (existing.length > 0) {
      if (existing.length !== input.candidate.evidence.length) {
        throw new Error("已冻结候选证据集合不能改写");
      }
      return existing.map(mapEvidence);
    }

    const frozen = [];
    for (const [ordinal, item] of input.candidate.evidence.entries()) {
      let materialId: string | undefined;
      if (item.material) {
        const current = await tx.researchCandidateMaterial.findUnique({
          where: { materialKey: item.material.materialKey },
        });
        if (current && current.contentHash !== item.material.contentHash) {
          throw new Error("相同材料身份不能绑定不同内容哈希");
        }
        if (
          current &&
          current.sourceAssertionId !==
            (item.material.sourceAssertionId ?? null)
        ) {
          throw new Error("相同材料身份不能改绑来源断言");
        }
        if (item.material.sourceAssertionId) {
          const sourceAssertion = await tx.sourceAssertion.findUnique({
            where: { id: item.material.sourceAssertionId },
          });
          if (!sourceAssertion) throw new Error("候选材料引用的来源断言不存在");
          if (sourceAssertion.contentHash !== item.material.contentHash) {
            throw new Error("候选材料内容哈希与来源断言不一致");
          }
        }
        const material =
          current ??
          (await tx.researchCandidateMaterial.create({
            data: {
              materialKey: item.material.materialKey,
              sourceAssertionId: item.material.sourceAssertionId,
              sourceItemKey: item.material.sourceItemKey,
              normalizedUrl: item.material.normalizedUrl,
              contentHash: item.material.contentHash,
              rawContentJson: toJson(item.material.rawContent),
              publishedAt: item.material.publishedAt
                ? new Date(item.material.publishedAt)
                : null,
              fetchedAt: new Date(item.material.fetchedAt),
            },
          }));
        materialId = material.id;
      }
      if (item.observationRevisionId) {
        const observation = await tx.dataObservationRevision.findUnique({
          where: { id: item.observationRevisionId },
        });
        if (!observation) throw new Error("候选引用的数据观测修订不存在");
        if (
          input.adjudication.outcome === "PROMOTE" &&
          observation.qualityStatus !== "NORMAL"
        ) {
          throw new Error("非正常质量的数据观测修订不能用于候选晋级");
        }
      }
      const row = await tx.researchEventCandidateEvidence.create({
        data: {
          id: deterministicId(
            "candidate_evidence",
            `${input.candidate.candidateKey}:${item.evidenceKey}`,
          ),
          candidateId,
          materialId,
          observationRevisionId: item.observationRevisionId,
          ordinal,
          evidenceRole: item.evidenceRole,
          sourceIdentityStatus: item.sourceIdentityStatus,
          proofQualification: item.proofQualification,
          independenceKey: item.independenceKey,
          citationJson: toJson({
            ...item.citation,
            evidenceKey: item.evidenceKey,
          }),
        },
      });
      frozen.push(mapEvidence(row));
    }
    return frozen;
  }

  private async replayed(candidateId: string, outcome: string) {
    return this.db.$transaction((tx) =>
      this.replayedInTransaction(tx, { candidateId, outcome }),
    );
  }

  private async replayedInTransaction(
    tx: TransactionClient,
    existing: { candidateId: string; outcome: string },
  ): Promise<ResearchProductionSettlement> {
    const revision = await tx.researchEventRevision.findFirst({
      where: { sourceCandidateId: existing.candidateId },
      orderBy: { revisionNo: "desc" },
    });
    return {
      replayed: true,
      outcome: existing.outcome as ResearchProductionSettlement["outcome"],
      candidateId: existing.candidateId,
      revision: revision ? await loadRevision(tx, revision.id) : null,
    };
  }
}

async function loadRevision(
  tx: Pick<PrismaClient, "researchEventRevision">,
  revisionId: string,
): Promise<FrozenResearchEventRevision> {
  const revision = await tx.researchEventRevision.findUniqueOrThrow({
    where: { id: revisionId },
    include: {
      event: true,
      claims: {
        orderBy: { ordinal: "asc" },
        include: {
          citations: {
            include: { candidateEvidence: true },
          },
        },
      },
      impacts: { orderBy: [{ subjectType: "asc" }, { subjectKey: "asc" }] },
    },
  });
  const evidence = new Map<
    string,
    FrozenResearchEventRevision["evidence"][number]
  >();
  for (const claim of revision.claims) {
    for (const citation of claim.citations) {
      const source = citation.candidateEvidence;
      const evidenceId = source?.id ?? citation.id;
      if (evidence.has(evidenceId)) continue;
      evidence.set(evidenceId, {
        id: evidenceId,
        summary: JSON.stringify(source?.citationJson ?? citation.citationJson),
        evidenceKey: evidenceKeyFromCitation(
          source?.citationJson ?? citation.citationJson,
          evidenceId,
        ),
        evidenceRole: source?.evidenceRole ?? "CORE_FACT",
        sourceIdentityStatus:
          source?.sourceIdentityStatus ?? citation.sourceIdentityStatus,
        proofQualification:
          source?.proofQualification ?? citation.proofQualification,
        independenceKey:
          source?.independenceKey ??
          citation.sourceAssertionId ??
          citation.observationRevisionId ??
          evidenceId,
        citation: isRecord(source?.citationJson ?? citation.citationJson)
          ? ((source?.citationJson ?? citation.citationJson) as Record<
              string,
              unknown
            >)
          : {},
      });
    }
  }
  return {
    revisionId: revision.id,
    eventId: revision.eventId,
    candidateId: revision.sourceCandidateId ?? "",
    eventKey: revision.event.eventKey,
    revisionKind: revision.revisionKind,
    subject: {
      type: revision.event.subjectType,
      key: revision.event.subjectKey,
    },
    occurredAt: revision.occurredAt.toISOString(),
    createdAt: revision.createdAt.toISOString(),
    narrative: parseNarrative(revision.narrativeJson),
    title: revision.title,
    summary: revision.summary,
    claims: revision.claims.map((claim) => ({
      id: claim.id,
      text: claim.claimText,
      evidenceRefs: claim.citations.map(
        (citation) => citation.candidateEvidenceId ?? citation.id,
      ),
    })),
    evidence: [...evidence.values()],
    impacts: revision.impacts.map((impact) => ({
      id: impact.id,
      subjectType:
        impact.subjectType as FrozenResearchEventRevision["impacts"][number]["subjectType"],
      subjectKey: impact.subjectKey,
      relation: impact.impactType === "DIRECT" ? "DIRECT" : "WEAK",
      materiality: normalizeMateriality(impact.materiality),
      path: asStringArray(impact.pathJson),
    })),
    cognitiveBaseline: [],
  };
}

function validatePromotionEvidence(
  input: ResearchProductionInput,
  evidence: Array<ReturnType<typeof mapEvidence>>,
) {
  if (input.adjudication.outcome !== "PROMOTE") return;
  const byKey = new Map(evidence.map((item) => [item.evidenceKey, item]));
  for (const claim of input.adjudication.claims) {
    const cited = claim.evidenceKeys.map((key) => byKey.get(key));
    if (cited.some((item) => !item)) {
      throw new Error("事件事实主张引用了未冻结证据");
    }
    const verified = cited.filter(
      (item) => item?.sourceIdentityStatus === "VERIFIED",
    );
    const independentlyCorroborated =
      new Set(
        verified
          .filter((item) => item?.proofQualification === "CORROBORATING_ONLY")
          .map((item) => item?.independenceKey),
      ).size >= 2;
    if (
      !verified.some((item) => item?.proofQualification === "QUALIFIED") &&
      !independentlyCorroborated
    ) {
      throw new Error("事件事实主张缺少合格证据或独立交叉印证");
    }
  }
}

function mapEvidence(row: {
  id: string;
  evidenceRole: string;
  sourceIdentityStatus: string;
  proofQualification: string;
  independenceKey: string;
  citationJson: unknown;
}) {
  const citation = isRecord(row.citationJson) ? row.citationJson : {};
  const evidenceKey =
    typeof citation.evidenceKey === "string" ? citation.evidenceKey : row.id;
  return {
    id: row.id,
    evidenceKey,
    evidenceRole: row.evidenceRole,
    sourceIdentityStatus: row.sourceIdentityStatus,
    proofQualification: row.proofQualification,
    independenceKey: row.independenceKey,
    citation,
  };
}

function requirePromotion(input: ResearchProductionInput["adjudication"]) {
  if (
    input.outcome !== "PROMOTE" ||
    !input.title ||
    !input.summary ||
    !input.occurredAt ||
    !input.knownAt ||
    !input.narrative
  ) {
    throw new Error("晋级裁定缺少事件修订输入");
  }
  return {
    ...input,
    title: input.title,
    summary: input.summary,
    occurredAt: input.occurredAt,
    knownAt: input.knownAt,
    narrative: input.narrative,
  };
}

function eventKeyFor(input: ResearchProductionInput) {
  return `event:${hashJson({
    canonicalizationVersion: "research-event-identity.v1",
    subjectType: input.candidate.subjectType,
    subjectKey: input.candidate.subjectKey,
    eventIdentityKey: input.candidate.eventIdentityKey,
  }).slice("sha256:".length)}`;
}

function candidateStatus(
  outcome: ResearchProductionInput["adjudication"]["outcome"],
) {
  const statuses = {
    PROMOTE: "PROMOTED",
    DEFER: "DEFERRED",
    REJECT: "REJECTED",
    TECHNICAL_HOLD: "TECHNICAL_HOLD",
  } as const;
  return statuses[outcome];
}

function normalizeMateriality(value: string): "LOW" | "MEDIUM" | "HIGH" {
  return value === "LOW" || value === "HIGH" ? value : "MEDIUM";
}

function evidenceKeyFromCitation(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.evidenceKey === "string"
    ? value.evidenceKey
    : fallback;
}

function parseNarrative(
  value: unknown,
): FrozenResearchEventRevision["narrative"] {
  const narrative = isRecord(value) ? value : {};
  return {
    impact:
      typeof narrative.impact === "string"
        ? narrative.impact
        : "研究影响仍需进一步核实。",
    reasons: asStringArray(narrative.reasons),
    nextChecks: asStringArray(narrative.nextChecks),
    risks: asStringArray(narrative.risks),
  };
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hashJson(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deterministicId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256")
    .update(value, "utf8")
    .digest("hex")}`;
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
