import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/modules/research/server/domain/workflow/types";
import { timingTemplateCodes } from "~/modules/research/ui/industry/workflow-shell-context";

export function buildRunDetailHref(params: {
  runId: string;
  templateCode?: string | null;
}) {
  if (params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return `/research/runs/${params.runId}`;
  }

  if (
    params.templateCode &&
    timingTemplateCodes.includes(params.templateCode as never)
  ) {
    return "/timing";
  }

  return `/research/runs/${params.runId}`;
}
