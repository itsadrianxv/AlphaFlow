import type { WorkspaceSection } from "~/app/_components/workspace-shell";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  INDUSTRY_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";

export type WorkflowHistoryQueryKind =
  | "screening"
  | "companyResearch"
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

  if (templateCode === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE) {
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
      templateCode === INDUSTRY_RESEARCH_TEMPLATE_CODE
        ? "/workflows"
        : "/workflows",
    historyHref: "/workflows/history",
    historyQueryKind: "workflows",
  };
}
