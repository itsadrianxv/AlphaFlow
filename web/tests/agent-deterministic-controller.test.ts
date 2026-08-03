import { describe, expect, it } from "vitest";
import {
  DeterministicController,
  settleAgentControllerOutput,
} from "~/server/application/agent-runtime/deterministic-controller";

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

  it("拒绝 Agent 直接结算外部投递和权威写入", () => {
    const controller = new DeterministicController();
    const externalDelivery = controller.settle(
      intent({
        intentId: "intent_delivery",
        intentType: "SEND_EXTERNAL_COPY",
        requiredCapabilities: ["delivery.request"],
        permission: "delivery:request",
        sideEffect: {
          kind: "EXTERNAL_DELIVERY",
          channel: "feishu",
          targetRefIds: ["target_1"],
        },
      }),
      context,
    );
    expect(externalDelivery).toMatchObject({
      status: "REJECTED",
      intentId: "intent_delivery",
    });

    const authoritativeWrite = controller.settle(
      intent({
        intentId: "intent_write",
        sideEffect: {
          kind: "AUTHORITATIVE_WRITE",
          targetRefIds: ["target_1"],
        },
      }),
      context,
    );
    expect(authoritativeWrite).toMatchObject({
      status: "REJECTED",
      intentId: "intent_write",
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
        intentType: "UPDATE_RESEARCH_FOCUS",
        sideEffect: {
          kind: "PREFERENCE_CHANGE",
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

  it("统一 research_only 约束拒绝结构化交易动作、仓位和价格指令", () => {
    const controller = new DeterministicController();

    const decision = controller.settle(
      intent({
        intentId: "intent_trade",
        intentType: "NO_SIDE_EFFECT",
        requiredCapabilities: [],
        permission: "researchPreference:write",
        proposedWrite: {
          action: "买入",
          positionSize: "三成仓",
          entryPrice: "25 元",
          targetPrice: "30 元",
          stopLossPrice: "22 元",
        },
      }),
      context,
    );

    expect(decision.status).toBe("REJECTED");
    expect(decision.status === "REJECTED" ? decision.reasons : []).toContain(
      "research_only 拒绝买卖、持有、加减仓、仓位、入场价、目标价、止损价或订单计划",
    );
  });
});

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
