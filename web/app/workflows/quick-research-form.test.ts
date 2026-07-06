import { describe, expect, it } from "vitest";
import { buildQuickResearchStartInput } from "~/app/workflows/quick-research-form";

describe("quick-research-form", () => {
  it("keeps standard mode payload free of an explicit deep task contract", () => {
    expect(
      buildQuickResearchStartInput({
        query: "AI infra",
        idempotencyKey: "",
        researchGoal: "Find monetization",
        mustAnswerQuestions: "",
        forbiddenEvidenceTypes: "",
        preferredSources: "",
        freshnessWindowDays: "180",
        deepMode: false,
      }).taskContract,
    ).toBeUndefined();
  });

  it("adds an explicit deep task contract when the deep mode switch is on", () => {
    expect(
      buildQuickResearchStartInput({
        query: "AI infra",
        idempotencyKey: "",
        researchGoal: "Find monetization",
        mustAnswerQuestions: "",
        forbiddenEvidenceTypes: "",
        preferredSources: "",
        freshnessWindowDays: "180",
        deepMode: true,
      }).taskContract,
    ).toEqual(
      expect.objectContaining({
        analysisDepth: "deep",
        deadlineMinutes: 30,
      }),
    );
  });
});
