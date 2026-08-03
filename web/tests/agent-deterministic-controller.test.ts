import { describe, expect, it } from "vitest";
import { DeterministicController } from "~/server/application/agent-runtime/deterministic-controller";

const context = {
  runId: "run_1",
  userId: "user_1",
  schemaVersion: "agent-intent.v1",
  allowedCapabilities: ["research_focus.write", "delivery.request"],
  allowedPermissions: ["researchPreference:write", "delivery:request"],
  availableObjectRefIds: ["target_1", "inbox_1"],
  availableEvidenceRefIds: ["evidence_1"],
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "agent-intent.v1",
    intentId: "intent_1",
    runId: "run_1",
    actorUserId: "user_1",
    intentType: "CREATE_RESEARCH_FOCUS",
    ambiguity: "UNAMBIGUOUS",
    reversible: true,
    batchSize: 1,
    objectRefs: [{ refId: "target_1", type: "company", id: "600000.SH" }],
    evidenceRefIds: ["evidence_1"],
    requiredCapabilities: ["research_focus.write"],
    permission: "researchPreference:write",
    proposedWrite: { focusLevel: "REGULAR" },
    ...overrides,
  };
}

describe("DeterministicController", () => {
  it("直接结算单义且可撤销的指令", () => {
    const decision = new DeterministicController().settle(intent(), context);

    expect(decision).toMatchObject({
      status: "SETTLED",
      confirmationLevel: "DIRECT",
      intentId: "intent_1",
    });
  });

  it("含糊、批量、扩大分发、受限资源和不可恢复操作需要二次确认", () => {
    const controller = new DeterministicController();
    const decision = controller.settle(
      intent({
        intentId: "intent_confirm",
        ambiguity: "AMBIGUOUS",
        batchSize: 2,
        reversible: false,
        intentType: "SEND_EXTERNAL_COPY",
        requiredCapabilities: ["delivery.request"],
        permission: "delivery:request",
        sideEffect: {
          kind: "EXTERNAL_DELIVERY",
          channel: "feishu",
          targetRefIds: ["target_1"],
          irreversible: true,
          expandsDistribution: true,
          touchesRestrictedResource: true,
        },
      }),
      context,
    );

    expect(decision).toMatchObject({
      status: "NEEDS_CONFIRMATION",
      confirmationLevel: "SECOND_CONFIRMATION_REQUIRED",
      intentId: "intent_confirm",
    });
    expect(decision.status === "NEEDS_CONFIRMATION" && decision.preciseImpact).toBeTruthy();

    const confirmed = controller.settle(
      intent({
        intentId: "intent_confirm",
        ambiguity: "AMBIGUOUS",
        batchSize: 2,
        reversible: false,
        requiredCapabilities: ["delivery.request"],
        permission: "delivery:request",
      }),
      {
        ...context,
        userConfirmation: {
          intentId: "intent_confirm",
          confirmed: true,
        },
      },
    );
    expect(confirmed.status).toBe("SETTLED");
  });

  it("在 schema、引用、版本、能力或权限不通过时拒绝副作用", () => {
    const controller = new DeterministicController();

    expect(controller.settle({ broken: true }, context)).toMatchObject({
      status: "REJECTED",
      reasons: ["Agent 输出不符合意图 schema"],
    });

    const decision = controller.settle(
      intent({
        schemaVersion: "agent-intent.v1",
        runId: "other_run",
        objectRefs: [{ refId: "missing_object", type: "company", id: "x" }],
        evidenceRefIds: ["missing_evidence"],
        requiredCapabilities: ["authority.write"],
        permission: "admin",
      }),
      context,
    );

    expect(decision.status).toBe("REJECTED");
    expect(decision.status === "REJECTED" ? decision.reasons : []).toEqual(
      expect.arrayContaining([
        "意图 runId 与当前运行不一致",
        "对象引用未闭合: missing_object",
        "证据引用未闭合: missing_evidence",
        "运行能力未授权: authority.write",
        "用户权限未授权: admin",
      ]),
    );
  });
});
