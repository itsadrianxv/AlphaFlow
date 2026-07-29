import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

export function buildRunDetailHref(params: {
  runId: string;
  templateCode?: string | null;
}) {
  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return `/company-research/${params.runId}`;
  }

  return `/workflows/${params.runId}`;
}
