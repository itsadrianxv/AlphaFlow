import { z } from "zod";

const allowedAgentIntentSchema = z.enum([
  "ANSWER_USER",
  "REQUEST_USER_CONFIRMATION",
  "PROPOSE_RESEARCH_UPDATE",
  "REQUEST_EXTERNAL_DELIVERY",
  "REQUEST_AUTHORITATIVE_WRITE",
]);

const blockedSideEffectKindSchema = z.enum([
  "AUTHORITATIVE_WRITE",
  "EXTERNAL_DELIVERY",
]);

const agentSideEffectSchema = z.object({
  kind: blockedSideEffectKindSchema,
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
  sideEffect: agentSideEffectSchema.optional(),
});

export type AgentControllerOutput = z.infer<typeof agentControllerOutputSchema>;

export type DeterministicControllerDecision =
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
): DeterministicControllerDecision {
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
