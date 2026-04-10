import type { WorkspaceSection } from "~/app/_components/workspace-shell";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";

export const timingTemplateCodes = [
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
] as const;

export type WorkflowHistoryQueryKind =
  | "screening"
  | "companyResearch"
  | "timing"
  | "workflows";

export function resolveWorkflowShellContext(templateCode?: string): {
  section: WorkspaceSection;
  backHref: string;
  historyHref: string;
  historyQueryKind: WorkflowHistoryQueryKind;
} {
  if (templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return {
      section: "companyResearch",
      backHref: "/company-research",
      historyHref: "/company-research/history",
      historyQueryKind: "companyResearch",
    };
  }

  if (templateCode && timingTemplateCodes.includes(templateCode as never)) {
    return {
      section: "timing",
      backHref: "/timing",
      historyHref: "/timing/history",
      historyQueryKind: "timing",
    };
  }

  if (
    templateCode === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE ||
    templateCode === SCREENING_TO_TIMING_TEMPLATE_CODE
  ) {
    return {
      section: "screening",
      backHref: "/screening",
      historyHref: "/screening/history",
      historyQueryKind: "screening",
    };
  }

  return {
    section: "workflows",
    backHref:
      templateCode === QUICK_RESEARCH_TEMPLATE_CODE
        ? "/workflows"
        : "/workflows",
    historyHref: "/workflows/history",
    historyQueryKind: "workflows",
  };
}
