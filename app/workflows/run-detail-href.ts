import { timingTemplateCodes } from "~/app/workflows/workflow-shell-context";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

export function buildRunDetailHref(params: {
  runId: string;
  templateCode?: string | null;
}) {
  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return `/company-research/${params.runId}`;
  }

  if (
    params.templateCode &&
    timingTemplateCodes.includes(params.templateCode as never)
  ) {
    return "/timing";
  }

  return `/workflows/${params.runId}`;
}
