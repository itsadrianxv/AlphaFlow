import { z } from "zod";

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const researchEventClaimTypeSchema = z.enum([
  "FACT",
  "RESEARCH_IMPLICATION",
]);

const materialSchema = z
  .object({
    materialKey: z.string().trim().min(1),
    sourceAssertionId: z.string().trim().min(1).optional(),
    sourceItemKey: z.string().trim().min(1).optional(),
    normalizedUrl: z.string().url().optional(),
    contentHash: hashSchema,
    rawContent: z.record(z.unknown()),
    publishedAt: z.string().datetime().optional(),
    fetchedAt: z.string().datetime(),
  })
  .strict();

const evidenceSchema = z
  .object({
    evidenceKey: z.string().trim().min(1),
    evidenceRole: z.enum(["CORE_FACT", "CONTEXT", "COUNTER_EVIDENCE"]),
    sourceIdentityStatus: z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN"]),
    proofQualification: z.enum([
      "QUALIFIED",
      "CORROBORATING_ONLY",
      "NOT_QUALIFIED",
    ]),
    independenceKey: z.string().trim().min(1),
    citation: z.record(z.unknown()),
    material: materialSchema.optional(),
    observationRevisionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.material)) +
        Number(Boolean(value.observationRevisionId)) ===
      1,
    "候选证据必须且只能引用材料或数据观测修订",
  );

const claimSchema = z
  .object({
    claimKey: z.string().trim().min(1),
    claimType: researchEventClaimTypeSchema,
    text: z.string().trim().min(1),
    isInference: z.boolean().default(false),
    evidenceKeys: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const impactSchema = z
  .object({
    subjectType: z.string().trim().min(1),
    subjectKey: z.string().trim().min(1),
    impactType: z.enum(["DIRECT", "INDIRECT"]),
    materiality: z.enum(["LOW", "MEDIUM", "HIGH"]),
    path: z.array(z.string().trim().min(1)).max(20),
  })
  .strict();

export const researchProductionInputSchema = z
  .object({
    contractVersion: z.literal("research-production.v1"),
    idempotencyKey: z.string().trim().min(1),
    candidate: z
      .object({
        candidateKey: z.string().trim().min(1),
        clusterKey: z.string().trim().min(1),
        subjectType: z.string().trim().min(1),
        subjectKey: z.string().trim().min(1),
        eventIdentityKey: z.string().trim().min(1),
        evidence: z.array(evidenceSchema).min(1).max(100),
      })
      .strict(),
    adjudication: z
      .object({
        outcome: z.enum(["PROMOTE", "DEFER", "REJECT", "TECHNICAL_HOLD"]),
        contractVersion: z.string().trim().min(1),
        model: z.string().trim().min(1),
        promptVersion: z.string().trim().min(1),
        schemaVersion: z.string().trim().min(1),
        title: z.string().trim().min(1).optional(),
        summary: z.string().trim().min(1).optional(),
        occurredAt: z.string().datetime().optional(),
        knownAt: z.string().datetime().optional(),
        narrative: z
          .object({
            impact: z.string().trim().min(1),
            reasons: z.array(z.string().trim().min(1)).min(1).max(20),
            nextChecks: z.array(z.string().trim().min(1)).max(20),
            risks: z.array(z.string().trim().min(1)).max(20),
          })
          .strict()
          .optional(),
        uncertainty: z.record(z.unknown()).default({}),
        counterEvidence: z.record(z.unknown()).default({}),
        claims: z.array(claimSchema).max(20).default([]),
        impacts: z.array(impactSchema).max(50).default([]),
        observationWindowEndsAt: z.string().datetime().optional(),
        nextCheckAt: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const evidenceKeys = new Set(
      input.candidate.evidence.map((item) => item.evidenceKey),
    );
    if (evidenceKeys.size !== input.candidate.evidence.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidate", "evidence"],
        message: "候选证据身份不能重复",
      });
    }
    for (const [index, claim] of input.adjudication.claims.entries()) {
      if (claim.evidenceKeys.some((key) => !evidenceKeys.has(key))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adjudication", "claims", index, "evidenceKeys"],
          message: "事件事实主张引用了未冻结的候选证据",
        });
      }
    }
    if (input.adjudication.outcome === "PROMOTE") {
      for (const field of [
        "title",
        "summary",
        "occurredAt",
        "knownAt",
        "narrative",
      ] as const) {
        if (!input.adjudication[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["adjudication", field],
            message: "晋级裁定缺少事件修订字段",
          });
        }
      }
      if (input.adjudication.claims.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adjudication", "claims"],
          message: "晋级裁定至少需要一项事件事实主张",
        });
      }
    }
  });

export type ResearchProductionInput = z.infer<
  typeof researchProductionInputSchema
>;
