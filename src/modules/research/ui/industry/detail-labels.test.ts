import { describe, expect, it } from "vitest";
import {
  COMPANY_RESEARCH_NODE_KEYS,
  COMPANY_RESEARCH_V1_NODE_KEYS,
  COMPANY_RESEARCH_V3_NODE_KEYS,
  COMPANY_RESEARCH_V4_NODE_KEYS,
  QUICK_RESEARCH_NODE_KEYS,
  SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
  SCREENING_TO_TIMING_NODE_KEYS,
  TIMING_REVIEW_LOOP_NODE_KEYS,
  TIMING_SIGNAL_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
} from "~/modules/research/server/domain/workflow/types";
import {
  formatResearchArtifactLabel,
  formatResearchCapabilityLabel,
  formatResearchRoleLabel,
  formatResearchUnitTitle,
  formatWorkflowNodeLabel,
} from "~/modules/research/ui/industry/detail-labels";

describe("detail-labels", () => {
  it("covers all registered workflow node keys with Chinese labels", () => {
    const allNodeKeys = [
      ...QUICK_RESEARCH_NODE_KEYS,
      ...COMPANY_RESEARCH_V1_NODE_KEYS,
      ...COMPANY_RESEARCH_NODE_KEYS,
      ...COMPANY_RESEARCH_V3_NODE_KEYS,
      ...COMPANY_RESEARCH_V4_NODE_KEYS,
      ...SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
      ...TIMING_SIGNAL_PIPELINE_NODE_KEYS,
      ...WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
      ...WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
      ...SCREENING_TO_TIMING_NODE_KEYS,
      ...TIMING_REVIEW_LOOP_NODE_KEYS,
    ];

    for (const nodeKey of allNodeKeys) {
      expect(formatWorkflowNodeLabel(nodeKey)).not.toBe(nodeKey);
    }
  });

  it("translates research capabilities, roles, artifacts, and unit ids", () => {
    expect(formatResearchCapabilityLabel("official_search")).toBe("官网检索");
    expect(formatResearchCapabilityLabel("financial_pack")).toBe("财务数据包");
    expect(formatResearchRoleLabel("official_collector")).toBe(
      "官网资料研究员",
    );
    expect(formatResearchRoleLabel("first_party_verifier")).toBe(
      "一手页面核验员",
    );
    expect(formatResearchArtifactLabel("official_evidence_bundle")).toBe(
      "官网证据包",
    );
    expect(formatResearchArtifactLabel("first_party_page_bundle")).toBe(
      "一手页面证据包",
    );
    expect(formatResearchUnitTitle("business_model")).toBe("商业模式");
    expect(formatResearchUnitTitle("financial_quality")).toBe("财务质量");
    expect(formatResearchUnitTitle("industry_landscape")).toBe("行业格局");
    expect(formatResearchUnitTitle("first_party_pages")).toBe("一手页面核验");
    expect(formatResearchUnitTitle("followup_2_1", "Follow-up 1")).toBe(
      "补充求证 1",
    );
  });
});
