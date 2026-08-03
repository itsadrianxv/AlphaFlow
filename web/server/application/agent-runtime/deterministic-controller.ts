import { z } from "zod";
import { violatesResearchOnly } from "~/server/application/agent-runtime/research-only-policy";

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

export type AgentSideEffect = z.infer<typeof agentSideEffectSchema>;
export type AgentProducedIntent = z.infer<typeof agentProducedIntentSchema>;

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

function directSideEffectViolation(intent: AgentProducedIntent) {
  if (
    intent.intentType === "SEND_EXTERNAL_COPY" ||
    intent.sideEffect?.kind === "EXTERNAL_DELIVERY"
  ) {
    return "Agent 不能选择外部投递对象、渠道或发送时机，必须由确定性代码重新计算";
  }
  if (intent.sideEffect?.kind === "AUTHORITATIVE_WRITE") {
    return "Agent 不能直接提交权威写入，必须由确定性代码重新计算写入对象、权限和内容";
  }
  return undefined;
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
    if (violatesResearchOnly(intent)) {
      reasons.push(
        "research_only 拒绝买卖、持有、加减仓、仓位、入场价、目标价、止损价或订单计划",
      );
    }
    const sideEffectViolation = directSideEffectViolation(intent);
    if (sideEffectViolation) reasons.push(sideEffectViolation);
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

const allowedAgentIntentSchema = z.enum([
  "ANSWER_USER",
  "REQUEST_USER_CONFIRMATION",
  "PROPOSE_RESEARCH_UPDATE",
  "REQUEST_EXTERNAL_DELIVERY",
  "REQUEST_AUTHORITATIVE_WRITE",
]);

const agentControllerSideEffectSchema = z.object({
  kind: z.enum(["AUTHORITATIVE_WRITE", "EXTERNAL_DELIVERY"]),
  channel: z.string().optional(),
  targetRefIds: z.array(z.string()).optional(),
  payload: z.unknown().optional(),
});

export const agentControllerOutputSchema = z.object({
  schemaVersion: z.literal("agent-controller-output.v1"),
  intent: allowedAgentIntentSchema,
  ambiguity: z.enum(["UNAMBIGUOUS", "AMBIGUOUS"]),
  reversible: z.boolean(),
  batchSize: z.number().int().min(1).default(1),
  targetRefIds: z.array(z.string()).default([]),
  sideEffect: agentControllerSideEffectSchema.optional(),
});

export type AgentControllerOutput = z.infer<typeof agentControllerOutputSchema>;

export type AgentControllerSettlementDecision =
  | {
      status: "SETTLED";
      intent: Exclude<
        AgentControllerOutput["intent"],
        "REQUEST_EXTERNAL_DELIVERY" | "REQUEST_AUTHORITATIVE_WRITE"
      >;
      targetRefIds: string[];
    }
  | {
      status: "NEEDS_SECOND_CONFIRMATION";
      reason: string;
      requestedIntent: AgentControllerOutput["intent"];
      targetRefIds: string[];
    }
  | {
      status: "REJECTED";
      reason: string;
      requestedIntent: AgentControllerOutput["intent"];
      targetRefIds: string[];
    };

export function settleAgentControllerOutput(
  rawOutput: unknown,
): AgentControllerSettlementDecision {
  const output = agentControllerOutputSchema.parse(rawOutput);

  if (
    output.sideEffect?.kind === "EXTERNAL_DELIVERY" ||
    output.intent === "REQUEST_EXTERNAL_DELIVERY"
  ) {
    return {
      status: "REJECTED",
      reason:
        "Agent 只能请求外部投递意图；收件人、渠道和发送时机必须由确定性代码重新计算。",
      requestedIntent: output.intent,
      targetRefIds: output.targetRefIds,
    };
  }

  if (
    output.sideEffect?.kind === "AUTHORITATIVE_WRITE" ||
    output.intent === "REQUEST_AUTHORITATIVE_WRITE"
  ) {
    return {
      status: "REJECTED",
      reason:
        "Agent 不能直接提交权威写入；写入对象、权限和 payload 必须由确定性代码重新计算。",
      requestedIntent: output.intent,
      targetRefIds: output.targetRefIds,
    };
  }

  if (output.ambiguity === "AMBIGUOUS") {
    return {
      status: "NEEDS_SECOND_CONFIRMATION",
      reason: "对象或意图含糊，需要用户二次确认。",
      requestedIntent: output.intent,
      targetRefIds: output.targetRefIds,
    };
  }

  if (!output.reversible || output.batchSize > 1) {
    return {
      status: "NEEDS_SECOND_CONFIRMATION",
      reason: "不可撤销或批量操作需要用户二次确认。",
      requestedIntent: output.intent,
      targetRefIds: output.targetRefIds,
    };
  }

  return {
    status: "SETTLED",
    intent: output.intent,
    targetRefIds: output.targetRefIds,
  };
}
