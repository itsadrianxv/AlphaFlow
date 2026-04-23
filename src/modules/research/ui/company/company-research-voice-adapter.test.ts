import { describe, expect, it } from "vitest";

import {
  applyCompanyResearchVoicePatch,
  buildCompanyResearchVoiceContext,
} from "~/modules/research/ui/company/company-research-voice-adapter";

describe("company research voice adapter", () => {
  it("builds company research voice context from the current page state", () => {
    const context = buildCompanyResearchVoiceContext(
      {
        companyName: "贵州茅台",
        stockCode: "600519",
        officialWebsite: "https://www.moutai.com.cn",
        focusConcepts: "高端白酒\n渠道价格",
        keyQuestion: "利润改善是否可持续",
        supplementalUrls: "https://example.com/1",
        idempotencyKey: "keep-me",
        researchGoal: "验证利润改善",
        mustAnswerQuestions: "量价能否维持\n库存是否健康",
        forbiddenEvidenceTypes: "短视频",
        preferredSources: "年报\n公告",
        freshnessWindowDays: "30",
      },
      ["样例一", "样例二"],
    );

    expect(context).toEqual({
      pageKind: "company_research",
      currentFields: {
        companyName: "贵州茅台",
        stockCode: "600519",
        keyQuestion: "利润改善是否可持续",
        focusConcepts: ["高端白酒", "渠道价格"],
        researchGoal: "验证利润改善",
        mustAnswerQuestions: ["量价能否维持", "库存是否健康"],
        preferredSources: ["年报", "公告"],
        freshnessWindowDays: 30,
      },
      starterExamples: ["样例一", "样例二"],
    });
  });

  it("applies only the whitelisted company research patch fields", () => {
    const nextState = applyCompanyResearchVoicePatch(
      {
        companyName: "旧公司",
        stockCode: "",
        officialWebsite: "https://example.com",
        focusConcepts: "",
        keyQuestion: "旧问题",
        supplementalUrls: "https://extra.example.com",
        idempotencyKey: "keep-key",
        researchGoal: "",
        mustAnswerQuestions: "",
        forbiddenEvidenceTypes: "短视频",
        preferredSources: "",
        freshnessWindowDays: "180",
      },
      {
        companyName: "贵州茅台",
        stockCode: "600519",
        keyQuestion: "利润改善是否可持续",
        focusConcepts: ["高端白酒", "渠道价格"],
        researchGoal: "确认利润修复持续性",
        mustAnswerQuestions: ["库存是否健康"],
        preferredSources: ["公告", "年报"],
        freshnessWindowDays: 90,
      },
    );

    expect(nextState).toEqual({
      companyName: "贵州茅台",
      stockCode: "600519",
      officialWebsite: "https://example.com",
      focusConcepts: "高端白酒\n渠道价格",
      keyQuestion: "利润改善是否可持续",
      supplementalUrls: "https://extra.example.com",
      idempotencyKey: "keep-key",
      researchGoal: "确认利润修复持续性",
      mustAnswerQuestions: "库存是否健康",
      forbiddenEvidenceTypes: "短视频",
      preferredSources: "公告\n年报",
      freshnessWindowDays: "90",
    });
  });
});
