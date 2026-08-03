import { describe, expect, it } from "vitest";
import {
  HARD_RELEASE_GATES,
  evaluateRelease,
  resolveDeterministicDegradation,
} from "~/server/domain/runtime-observability/release-gates";
import {
  InMemoryRuntimeObservabilityRepository,
  RuntimeObservabilityService,
} from "~/server/application/runtime-observability/runtime-observability-service";

describe("运行目标与发布门禁", () => {
  it("硬门槛失败时阻断发布，不能用运行目标降级放行", () => {
    const result = evaluateRelease({
      checks: HARD_RELEASE_GATES.map((id) => ({
        id,
        status: id === "observability" ? "FAIL" : "PASS",
        evidence: `evidence:${id}`,
      })),
      runtimeBreaches: ["PRODUCT_P95"],
    });

    expect(result.allowed).toBe(false);
    expect(result.hardGateFailures).toEqual(["observability"]);
    expect(result.runtimeDegradation.mode).toBe("RESEARCH_ONLY_DEGRADED");
  });

  it("硬门槛全部通过时允许发布，但运行目标违约仍可观测", () => {
    const result = evaluateRelease({
      checks: HARD_RELEASE_GATES.map((id) => ({
        id,
        status: "PASS",
        evidence: `evidence:${id}`,
      })),
      runtimeBreaches: ["PRODUCT_P95"],
    });

    expect(result.allowed).toBe(true);
    expect(result.runtimeDegradation.mode).toBe("RESEARCH_ONLY_DEGRADED");
  });

  it("只返回规格允许的确定性降级，且不放宽证据、引用、门控和 research_only", () => {
    expect(resolveDeterministicDegradation("REQUIRED_DATA_LATE")).toMatchObject({
      mode: "SERVE_PREVIOUS_SNAPSHOT",
      preserveEvidence: true,
      preserveCitations: true,
      preserveDistributionGate: true,
      researchOnly: true,
    });
    expect(resolveDeterministicDegradation("FEISHU_FAILED").mode).toBe(
      "INBOX_ONLY_RETRY_EXTERNAL_COPY",
    );
    expect(() =>
      resolveDeterministicDegradation("UNKNOWN_FAILURE" as never),
    ).toThrow(/不允许/);
  });

  it("持久化发布评估并按评估幂等键复用历史", async () => {
    const runtime = new RuntimeObservabilityService(
      new InMemoryRuntimeObservabilityRepository(),
    );
    const checks = HARD_RELEASE_GATES.map((id) => ({
      id,
      status: "PASS" as const,
      evidence: `evidence:${id}`,
    }));
    const first = await runtime.recordReleaseEvaluation({
      evaluationKey: "release-2026-08-03",
      checks,
      runtimeBreaches: [],
    });
    const second = await runtime.recordReleaseEvaluation({
      evaluationKey: "release-2026-08-03",
      checks: checks.map((check) => ({ ...check, evidence: "changed" })),
      runtimeBreaches: ["ignored-on-replay"],
    });

    expect(second).toEqual(first);
    expect(await runtime.listReleaseEvaluations()).toHaveLength(1);
  });

  it("缺少证据、重复检查或待人工完成的硬门槛均阻断发布", () => {
    const checks = HARD_RELEASE_GATES.map((id) => ({
      id,
      status: "PASS" as const,
      evidence: `evidence:${id}`,
    }));
    const result = evaluateRelease({
      checks: [
        ...checks.map((check) =>
          check.id === "schema_and_types"
            ? { ...check, evidence: "" }
            : check.id === "compliance_process"
              ? { ...check, status: "MANUAL_REQUIRED" as const }
              : check,
        ),
        checks.find((check) => check.id === "provider_contract")!,
      ],
      runtimeBreaches: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.hardGateFailures).toEqual(
      expect.arrayContaining([
        "schema_and_types",
        "provider_contract",
        "compliance_process",
      ]),
    );
    expect(result.manualChecks).toEqual(["compliance_process"]);
  });
});
