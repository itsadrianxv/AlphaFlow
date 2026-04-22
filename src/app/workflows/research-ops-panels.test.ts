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

  it("localizes persisted english workflow keywords for historical runs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResearchOpsPanels, {
        result: {
          researchPlan: [
            {
              id: "business_model",
              title: "Business model",
              capability: "official_search",
              role: "official_collector",
              priority: "high",
              expectedArtifact: "official_evidence_bundle",
              dependsOn: [],
              fallbackCapabilities: ["page_scrape", "news_search"],
              acceptanceCriteria: [
                "Prefer first-party or near first-party disclosures.",
                "Return URLs that can support downstream citations.",
              ],
            },
            {
              id: "first_party_pages",
              title: "First-party pages",
              capability: "page_scrape",
              role: "first_party_verifier",
              priority: "medium",
              expectedArtifact: "first_party_page_bundle",
              dependsOn: ["business_model"],
              fallbackCapabilities: ["official_search"],
              acceptanceCriteria: [
                "Extract verifiable first-party facts from the page.",
              ],
            },
            {
              id: "followup_1_1",
              title: "Follow-up 1",
              capability: "news_search",
              role: "news_collector",
              priority: "medium",
              expectedArtifact: "news_evidence_bundle",
              dependsOn: [],
              fallbackCapabilities: ["official_search"],
              acceptanceCriteria: [
                "Return recent event evidence tied to catalysts or risks.",
              ],
            },
          ],
          researchUnitRuns: [
            {
              unitId: "business_model",
              status: "running",
              attempt: 1,
              repairCount: 0,
              qualityFlags: [],
              fallbackUsed: "page_scrape",
            },
          ],
          replanRecords: [
            {
              replanId: "replan_2",
              iteration: 1,
              triggerNodeKey: "load_targets",
              reason: "unit_failed",
              action: "expand_sources",
              resultSummary:
                "Some important questions remain under-supported and need a bounded follow-up search.",
              fallbackCapability: "official_search",
              missingAreas: ["no_candidates"],
            },
          ],
        },
      }),
    );

    expect(markup).toContain("商业模式");
    expect(markup).toContain("一手页面核验");
    expect(markup).toContain("补充求证 1");
    expect(markup).toContain("官网检索");
    expect(markup).toContain("一手页面核验员");
    expect(markup).toContain("官网证据包");
    expect(markup).toContain("优先采用公司公告、官网或招股书等一手披露。");
    expect(markup).toContain("返回可用于后续引用的链接。");
    expect(markup).toContain("依赖：商业模式");
    expect(markup).toContain("触发节点：载入分析标的");
    expect(markup).toContain("研究单元失败");
    expect(markup).toContain("缺少候选标的");
    expect(markup).not.toContain("Business model");
    expect(markup).not.toContain("First-party pages");
    expect(markup).not.toContain("Follow-up 1");
    expect(markup).not.toContain("official_search");
    expect(markup).not.toContain("page_scrape");
    expect(markup).not.toContain("load_targets");
  });
});
