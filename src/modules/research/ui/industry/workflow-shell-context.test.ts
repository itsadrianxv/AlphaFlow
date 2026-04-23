import { describe, expect, it } from "vitest";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import { resolveWorkflowShellContext } from "~/modules/research/ui/industry/workflow-shell-context";

describe("resolveWorkflowShellContext", () => {
  it("keeps company research runs inside the company research shell", () => {
    expect(resolveWorkflowShellContext(COMPANY_RESEARCH_TEMPLATE_CODE)).toEqual(
      {
        section: "companyResearch",
        backHref: "/research/company",
        historyHref: "/research/company/history",
        historyQueryKind: "companyResearch",
      },
    );
  });

  it("routes timing templates back to the timing shell", () => {
    for (const templateCode of [
      TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
      WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
      WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
      TIMING_REVIEW_LOOP_TEMPLATE_CODE,
    ]) {
      expect(resolveWorkflowShellContext(templateCode)).toEqual({
        section: "timing",
        backHref: "/timing",
        historyHref: "/timing/history",
        historyQueryKind: "timing",
      });
    }
  });

  it("routes screening-linked templates back to the screening shell", () => {
    for (const templateCode of [
      SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
      SCREENING_TO_TIMING_TEMPLATE_CODE,
    ]) {
      expect(resolveWorkflowShellContext(templateCode)).toEqual({
        section: "screening",
        backHref: "/screening",
        historyHref: "/screening/history",
        historyQueryKind: "screening",
      });
    }
  });

  it("falls back to the workflows shell for other templates", () => {
    expect(resolveWorkflowShellContext(QUICK_RESEARCH_TEMPLATE_CODE)).toEqual({
      section: "workflows",
      backHref: "/research",
      historyHref: "/research/history",
      historyQueryKind: "workflows",
    });
    expect(resolveWorkflowShellContext(undefined)).toEqual({
      section: "workflows",
      backHref: "/research",
      historyHref: "/research/history",
      historyQueryKind: "workflows",
    });
  });
});
