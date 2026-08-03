import { z } from "zod";

const SUPPORTED_SCHEMA_VERSION = "agent-intent.v1";

export type ConfirmationLevel =
  | "DIRECT"
  | "SECOND_CONFIRMATION_REQUIRED"
  | "REJECTED";

export type DeterministicControllerDecision =
  | {
      status: "SETTLED";
      confirmationLevel: "DIRECT";
      intentId: string;
      sideEffect?: AgentSideEffect;
      followUpObject: Record<string, unknown>;
    }
  | {
      status: "NEEDS_CONFIRMATION";
      confirmationLevel: "SECOND_CONFIRMATION_REQUIRED";
      intentId: string;
      reasons: string[];
      preciseImpact: Record<string, unknown>;
    }
  | {
      status: "REJECTED";
      confirmationLevel: "REJECTED";
      intentId?: string;
      reasons: string[];
    };

export type AgentSideEffect = z.infer<typeof agentSideEffectSchema>;
export type AgentProducedIntent = z.infer<typeof agentProducedIntentSchema>;

const objectRefSchema = z.object({
  refId: z.string().min(1),
  type: z.string().min(1),
  id: z.string().min(1),
});

const agentSideEffectSchema = z.object({
  kind: z.enum([
    "AUTHORITATIVE_WRITE",
    "EXTERNAL_DELIVERY",
    "PREFERENCE_CHANGE",
  ]),
  channel: z.string().min(1).optional(),
  targetRefIds: z.array(z.string().min(1)).default([]),
  irreversible: z.boolean().default(false),
  expandsDistribution: z.boolean().default(false),
  touchesRestrictedResource: z.boolean().default(false),
});

export const agentProducedIntentSchema = z.object({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  intentId: z.string().min(1),
  runId: z.string().min(1),
  actorUserId: z.string().min(1),
  intentType: z.enum([
    "CREATE_RESEARCH_FOCUS",
    "UPDATE_RESEARCH_FOCUS",
    "ARCHIVE_INBOX_ITEM",
    "SEND_EXTERNAL_COPY",
    "DELETE_RESEARCH_PREFERENCE",
    "NO_SIDE_EFFECT",
  ]),
  ambiguity: z.enum(["UNAMBIGUOUS", "AMBIGUOUS"]).default("UNAMBIGUOUS"),
  reversible: z.boolean().default(true),
  batchSize: z.number().int().min(1).default(1),
  objectRefs: z.array(objectRefSchema).default([]),
  evidenceRefIds: z.array(z.string().min(1)).default([]),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  permission: z.string().min(1),
  sideEffect: agentSideEffectSchema.optional(),
  proposedWrite: z.record(z.unknown()).optional(),
});

export type DeterministicControllerContext = {
  runId: string;
  userId: string;
  schemaVersion?: string;
  allowedCapabilities: string[];
  allowedPermissions: string[];
  availableObjectRefIds: string[];
  availableEvidenceRefIds: string[];
  userConfirmation?: {
    intentId: string;
    confirmed: boolean;
  };
};

function unique(values: string[]) {
  return [...new Set(values)];
}

function missingRefs(requested: string[], available: string[]) {
  const availableSet = new Set(available);
  return unique(requested).filter((refId) => !availableSet.has(refId));
}

function requiresSecondConfirmation(intent: AgentProducedIntent) {
  return (
    intent.ambiguity === "AMBIGUOUS" ||
    intent.batchSize > 1 ||
    !intent.reversible ||
    intent.sideEffect?.expandsDistribution === true ||
    intent.sideEffect?.touchesRestrictedResource === true ||
    intent.sideEffect?.irreversible === true
  );
}

function buildPreciseImpact(intent: AgentProducedIntent) {
  return {
    intentType: intent.intentType,
    batchSize: intent.batchSize,
    objectRefs: intent.objectRefs,
    sideEffect: intent.sideEffect,
    proposedWrite: intent.proposedWrite,
  };
}

export class DeterministicController {
  settle(
    rawIntent: unknown,
    context: DeterministicControllerContext,
  ): DeterministicControllerDecision {
    const parsed = agentProducedIntentSchema.safeParse(rawIntent);
    if (!parsed.success) {
      return {
        status: "REJECTED",
        confirmationLevel: "REJECTED",
        reasons: ["Agent 输出不符合意图 schema"],
      };
    }

    const intent = parsed.data;
    const reasons: string[] = [];
    if (intent.runId !== context.runId) {
      reasons.push("意图 runId 与当前运行不一致");
    }
    if (intent.actorUserId !== context.userId) {
      reasons.push("意图发起用户与当前用户不一致");
    }
    if (
      context.schemaVersion &&
      intent.schemaVersion !== context.schemaVersion
    ) {
      reasons.push("意图 schema 版本不兼容");
    }

    const missingObjectRefs = missingRefs(
      [
        ...intent.objectRefs.map((ref) => ref.refId),
        ...(intent.sideEffect?.targetRefIds ?? []),
      ],
      context.availableObjectRefIds,
    );
    if (missingObjectRefs.length > 0) {
      reasons.push(`对象引用未闭合: ${missingObjectRefs.join(", ")}`);
    }

    const missingEvidenceRefs = missingRefs(
      intent.evidenceRefIds,
      context.availableEvidenceRefIds,
    );
    if (missingEvidenceRefs.length > 0) {
      reasons.push(`证据引用未闭合: ${missingEvidenceRefs.join(", ")}`);
    }

    const missingCapabilities = missingRefs(
      intent.requiredCapabilities,
      context.allowedCapabilities,
    );
    if (missingCapabilities.length > 0) {
      reasons.push(`运行能力未授权: ${missingCapabilities.join(", ")}`);
    }

    if (!context.allowedPermissions.includes(intent.permission)) {
      reasons.push(`用户权限未授权: ${intent.permission}`);
    }

    if (reasons.length > 0) {
      return {
        status: "REJECTED",
        confirmationLevel: "REJECTED",
        intentId: intent.intentId,
        reasons,
      };
    }

    if (requiresSecondConfirmation(intent)) {
      if (
        context.userConfirmation?.intentId === intent.intentId &&
        context.userConfirmation.confirmed
      ) {
        return {
          status: "SETTLED",
          confirmationLevel: "DIRECT",
          intentId: intent.intentId,
          sideEffect: intent.sideEffect,
          followUpObject: {
            kind: "confirmed_intent",
            intentId: intent.intentId,
            impact: buildPreciseImpact(intent),
          },
        };
      }

      return {
        status: "NEEDS_CONFIRMATION",
        confirmationLevel: "SECOND_CONFIRMATION_REQUIRED",
        intentId: intent.intentId,
        reasons: ["该意图需要二次确认"],
        preciseImpact: buildPreciseImpact(intent),
      };
    }

    return {
      status: "SETTLED",
      confirmationLevel: "DIRECT",
      intentId: intent.intentId,
      sideEffect: intent.sideEffect,
      followUpObject: {
        kind: "settled_intent",
        intentId: intent.intentId,
        impact: buildPreciseImpact(intent),
      },
    };
  }
}
