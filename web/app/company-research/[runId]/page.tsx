import { RunInvestorClient } from "~/app/workflows/[runId]/run-investor-client";
import { requireAuth } from "~/server/auth/require-auth";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function CompanyResearchRunDetailPage({
  params,
}: PageProps) {
  const { runId } = await params;
  await requireAuth(`/company-research/${runId}`);

  return (
    <RunInvestorClient
      runId={runId}
      initialTemplateCode={COMPANY_RESEARCH_TEMPLATE_CODE}
    />
  );
}
