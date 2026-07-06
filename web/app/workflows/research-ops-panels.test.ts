import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResearchOpsPanels } from "~/app/workflows/research-ops-panels";

describe("ResearchOpsPanels", () => {
  it("renders markdown summaries and translates standard runtime labels", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResearchOpsPanels, {
        result: {
          researchPlan: [
            {
              id: "unit_1",
              title: "官网信源补充",
              capability: "official_sources",
              role: "research_analyst",
              priority: "high",
              expectedArtifact: "research_note",
              dependsOn: [],
              fallbackCapabilities: ["web_search"],
              acceptanceCriteria: ["补充一手信源"],
            },
          ],
          researchUnitRuns: [
            {
              unitId: "unit_1",
              status: "completed",
              attempt: 2,
              repairCount: 1,
              qualityFlags: ["first_party_low"],
              fallbackUsed: "web_search",
            },
          ],
          replanRecords: [
            {
              replanId: "replan_1",
              iteration: 2,
              triggerNodeKey: "collect_company_evidence",
              reason: "citation_coverage_low",
              action: "expand_sources",
              resultSummary: "改为补充**一手信源**。",
              fallbackCapability: "web_search",
              missingAreas: ["citation_coverage_below_target"],
            },
          ],
          reflection: {
            status: "warn",
            summary: "需要**补充官网信源**。",
            contractScore: 88,
            citationCoverage: 0.75,
            firstPartyRatio: 0.25,
            missingRequirements: ["citation_coverage_below_target"],
            unansweredQuestions: [],
            qualityFlags: ["first_party_low"],
            suggestedFixes: ["补充公告与财报验证"],
          },
        },
      }),
    );

    expect(markup).toContain("第 1 层");
    expect(markup).toContain("1 个单元");
    expect(markup).toContain("交付物：研究备忘录");
    expect(markup).toContain("依赖：无");
    expect(markup).toContain("回退能力：网页搜索");
    expect(markup).toContain("尝试 2 次");
    expect(markup).toContain("修复 1 次");
    expect(markup).toContain("第 2 次重规划");
    expect(markup).toContain("触发节点：采集公司证据");
    expect(markup).toMatch(/<strong[^>]*>一手信源<\/strong>/);
    expect(markup).toContain("合同得分");
    expect(markup).toContain("引用覆盖");
    expect(markup).toContain("一手占比");
    expect(markup).toMatch(/<strong[^>]*>补充官网信源<\/strong>/);
    expect(markup).toContain("质量标记");
    expect(markup).toContain("一手信源覆盖不足");
    expect(markup).toContain("待补要求");
    expect(markup).toContain("引用覆盖未达到目标");
    expect(markup).toContain("修复建议");
    expect(markup).not.toContain("No reflection summary available.");
  });
});
