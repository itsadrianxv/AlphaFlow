import { describe, expect, it } from "vitest";
import { settleAgentControllerOutput } from "~/server/application/agent-runtime/deterministic-controller";

const baseOutput = {
  schemaVersion: "agent-controller-output.v1",
  ambiguity: "UNAMBIGUOUS",
  reversible: true,
  batchSize: 1,
  targetRefIds: ["target-1"],
} as const;

describe("deterministic controller", () => {
  it("不让单义外部投递从 Agent 输出直接结算", () => {
    const decision = settleAgentControllerOutput({
      ...baseOutput,
      intent: "REQUEST_EXTERNAL_DELIVERY",
      sideEffect: {
        kind: "EXTERNAL_DELIVERY",
        channel: "email",
        targetRefIds: ["target-1"],
        payload: { subject: "外部副本" },
      },
    });

    expect(decision).toMatchObject({
      status: "REJECTED",
      requestedIntent: "REQUEST_EXTERNAL_DELIVERY",
    });
    expect(JSON.stringify(decision)).not.toContain("email");
  });

  it("不让权威写入 sideEffect 从 Agent 输出直通结算", () => {
    const decision = settleAgentControllerOutput({
      ...baseOutput,
      intent: "REQUEST_AUTHORITATIVE_WRITE",
      sideEffect: {
        kind: "AUTHORITATIVE_WRITE",
        payload: { table: "ResearchPreference", op: "DELETE" },
      },
    });

    expect(decision).toMatchObject({
      status: "REJECTED",
      requestedIntent: "REQUEST_AUTHORITATIVE_WRITE",
    });
    expect(JSON.stringify(decision)).not.toContain("ResearchPreference");
  });

  it("含糊或批量的普通意图需要二次确认", () => {
    expect(
      settleAgentControllerOutput({
        ...baseOutput,
        intent: "PROPOSE_RESEARCH_UPDATE",
        ambiguity: "AMBIGUOUS",
      }),
    ).toMatchObject({ status: "NEEDS_SECOND_CONFIRMATION" });

    expect(
      settleAgentControllerOutput({
        ...baseOutput,
        intent: "PROPOSE_RESEARCH_UPDATE",
        batchSize: 2,
      }),
    ).toMatchObject({ status: "NEEDS_SECOND_CONFIRMATION" });
  });

  it("只结算可撤销、单义、非外部副作用的有界意图", () => {
    expect(
      settleAgentControllerOutput({
        ...baseOutput,
        intent: "PROPOSE_RESEARCH_UPDATE",
      }),
    ).toEqual({
      status: "SETTLED",
      intent: "PROPOSE_RESEARCH_UPDATE",
      targetRefIds: ["target-1"],
    });
  });
});
