import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const citationSchema = z
  .object({
    candidateEvidenceId: z.string().min(1).optional(),
    sourceAssertionId: z.string().min(1).optional(),
    observationRevisionId: z.string().min(1).optional(),
    relation: z.enum(["SUPPORTS", "CONTRADICTS", "CONTEXT"]),
    sourceIdentityStatus: z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN"]),
    proofQualification: z.enum([
      "QUALIFIED",
      "CORROBORATING_ONLY",
      "NOT_QUALIFIED",
    ]),
    citation: z.record(z.unknown()),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.candidateEvidenceId)) +
        Number(Boolean(value.sourceAssertionId)) +
        Number(Boolean(value.observationRevisionId)) ===
      1,
    "引用必须且只能绑定一个权威证据",
  );

export const researchEventRevisionCommandSchema = z
  .object({
    eventId: z.string().min(1),
    expectedRevisionId: z.string().min(1),
    commandId: z.string().min(1),
    revisionKind: z.enum(["CORRECTED", "RETRACTED"]),
    reason: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    narrative: z.record(z.unknown()),
    uncertainty: z.record(z.unknown()),
    counterEvidence: z.record(z.unknown()),
    occurredAt: z.string().datetime(),
    knownAt: z.string().datetime(),
    claims: z
      .array(
        z
          .object({
            claimType: z.string().min(1),
            text: z.string().min(1),
            isInference: z.boolean().default(false),
            citations: z.array(citationSchema).min(1),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type ResearchEventRevisionCommand = z.infer<
  typeof researchEventRevisionCommandSchema
>;

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class ResearchEventCorrectionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock = () => new Date(),
  ) {}

  async execute(raw: ResearchEventRevisionCommand) {
    const input = researchEventRevisionCommandSchema.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const auditKey = `research-event-revision:${input.commandId}`;
        const repeated = await tx.researchAuditRecord.findUnique({
          where: { auditKey },
        });
        if (repeated?.eventRevisionId)
          return tx.researchEventRevision.findUniqueOrThrow({
            where: { id: repeated.eventRevisionId },
          });
        const events = await tx.$queryRaw<
          Array<{ id: string; currentRevisionId: string | null }>
        >(
          Prisma.sql`SELECT "id", "currentRevisionId" FROM "ResearchEvent" WHERE "id" = ${input.eventId} FOR UPDATE`,
        );
        const event = events[0];
        if (!event) throw new Error("研究事件不存在");
        if (event.currentRevisionId !== input.expectedRevisionId)
          throw new Error("expected current revision 不匹配");
        const previous = await tx.researchEventRevision.findUnique({
          where: { id: input.expectedRevisionId },
        });
        if (!previous) throw new Error("expected revision 不存在");
        const revision = await tx.researchEventRevision.create({
          data: {
            id: randomUUID(),
            eventId: input.eventId,
            revisionNo: previous.revisionNo + 1,
            revisionDedupKey: `command:${input.commandId}`,
            revisionKind: input.revisionKind,
            supersedesRevisionId: previous.id,
            title: input.title,
            summary: input.summary,
            narrativeJson: json(input.narrative),
            uncertaintyJson: json(input.uncertainty),
            counterEvidenceJson: json(input.counterEvidence),
            occurredAt: new Date(input.occurredAt),
            knownAt: new Date(input.knownAt),
          },
        });
        for (const [ordinal, claimInput] of input.claims.entries()) {
          const claim = await tx.researchEventClaim.create({
            data: {
              eventRevisionId: revision.id,
              ordinal,
              claimType: claimInput.claimType,
              claimText: claimInput.text,
              isInference: claimInput.isInference,
            },
          });
          for (const citation of claimInput.citations) {
            if (
              citation.candidateEvidenceId &&
              !(await tx.researchEventCandidateEvidence.findUnique({
                where: { id: citation.candidateEvidenceId },
              }))
            )
              throw new Error("候选证据引用不存在");
            if (
              citation.sourceAssertionId &&
              !(await tx.sourceAssertion.findUnique({
                where: { id: citation.sourceAssertionId },
              }))
            )
              throw new Error("来源断言引用不存在");
            if (
              citation.observationRevisionId &&
              !(await tx.dataObservationRevision.findUnique({
                where: { id: citation.observationRevisionId },
              }))
            )
              throw new Error("观测修订引用不存在");
            await tx.researchEventClaimCitation.create({
              data: {
                claimId: claim.id,
                candidateEvidenceId: citation.candidateEvidenceId,
                sourceAssertionId: citation.sourceAssertionId,
                observationRevisionId: citation.observationRevisionId,
                relation: citation.relation,
                sourceIdentityStatus: citation.sourceIdentityStatus,
                proofQualification: citation.proofQualification,
                citationJson: json(citation.citation),
              },
            });
          }
        }
        await tx.researchEvent.update({
          where: { id: event.id },
          data: {
            currentRevisionId: revision.id,
            ...(input.revisionKind === "RETRACTED"
              ? { status: "RETRACTED" }
              : {}),
          },
        });
        await tx.researchAuditRecord.create({
          data: {
            auditKey,
            actorType: "DETERMINISTIC_CONTROLLER",
            action:
              input.revisionKind === "RETRACTED"
                ? "RESEARCH_EVENT_RETRACTED"
                : "RESEARCH_EVENT_CORRECTED",
            entityType: "RESEARCH_EVENT_REVISION",
            entityId: revision.id,
            eventRevisionId: revision.id,
            inputContractVersion: "research-event-revision-command.v1",
            outcome: "SUCCEEDED",
            detailsJson: json({
              reason: input.reason,
              supersedesRevisionId: previous.id,
            }),
            occurredAt: this.clock(),
          },
        });
        return revision;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
