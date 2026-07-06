import { describe, expect, it } from "vitest";
import { buildIndustryResearchStartInput } from "~/app/workflows/industry-research-form";

describe("industry-research-form", () => {
  it("keeps standard mode payload free of an explicit deep task contract", () => {
    expect(
      buildIndustryResearchStartInput({
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
      buildIndustryResearchStartInput({
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
