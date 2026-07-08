import { describe, expect, it } from "vitest";
import {
  MAX_SELECTED_SKILLS_MESSAGE,
  normalizeSelectedSkillIds,
} from "~/server/application/agent-runtime/skill-selection";

describe("normalizeSelectedSkillIds", () => {
  it("keeps single skillId compatible", () => {
    expect(
      normalizeSelectedSkillIds({
        skillId: "alphaflow-research-assistant",
      }),
    ).toEqual({
      skillId: "alphaflow-research-assistant",
      skillIds: ["alphaflow-research-assistant"],
    });
  });

  it("deduplicates skillIds and keeps order", () => {
    expect(
      normalizeSelectedSkillIds({
        skillId: "a",
        skillIds: ["b", "a", "c", "b"],
      }),
    ).toEqual({
      skillId: "b",
      skillIds: ["b", "a", "c"],
    });
  });

  it("rejects empty selection", () => {
    expect(() => normalizeSelectedSkillIds({ skillIds: [" "] })).toThrow(
      "请选择 skill",
    );
  });

  it("rejects more than three skills", () => {
    expect(() =>
      normalizeSelectedSkillIds({
        skillIds: ["a", "b", "c", "d"],
      }),
    ).toThrow(MAX_SELECTED_SKILLS_MESSAGE);
  });
});
