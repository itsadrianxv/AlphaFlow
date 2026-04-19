import { describe, expect, it } from "vitest";

import {
  applyWorkflowsVoicePatch,
  buildWorkflowsVoiceContext,
} from "~/app/workflows/workflows-voice-adapter";

describe("workflows voice adapter", () => {
  it("builds quick research voice context from the current form state", () => {
    const context = buildWorkflowsVoiceContext(
      {
        query: "半导体设备国产替代",
        researchGoal: "验证兑现节奏",
        mustAnswerQuestions: "谁先受益\n哪些指标领先",
        forbiddenEvidenceTypes: "论坛帖子",
        preferredSources: "公司公告\n财报",
        freshnessWindowDays: "90",
        deepMode: true,
        idempotencyKey: "keep-me",
      },
      ["提示词一", "提示词二"],
    );

    expect(context).toEqual({
      pageKind: "quick_research",
      currentFields: {
        query: "半导体设备国产替代",
        researchGoal: "验证兑现节奏",
        mustAnswerQuestions: ["谁先受益", "哪些指标领先"],
        preferredSources: ["公司公告", "财报"],
        freshnessWindowDays: 90,
      },
      starterExamples: ["提示词一", "提示词二"],
    });
  });

  it("applies only the whitelisted quick research patch fields", () => {
    const nextState = applyWorkflowsVoicePatch(
      {
        query: "旧问题",
        researchGoal: "",
        mustAnswerQuestions: "",
        forbiddenEvidenceTypes: "论坛帖子",
        preferredSources: "",
        freshnessWindowDays: "180",
        deepMode: true,
        idempotencyKey: "fixed-key",
      },
      {
        query: "新问题",
        researchGoal: "新目标",
        mustAnswerQuestions: ["问题一", "问题二"],
        preferredSources: ["公告", "财报"],
        freshnessWindowDays: 30,
      },
    );

    expect(nextState).toEqual({
      query: "新问题",
      researchGoal: "新目标",
      mustAnswerQuestions: "问题一\n问题二",
      forbiddenEvidenceTypes: "论坛帖子",
      preferredSources: "公告\n财报",
      freshnessWindowDays: "30",
      deepMode: true,
      idempotencyKey: "fixed-key",
    });
  });
});
