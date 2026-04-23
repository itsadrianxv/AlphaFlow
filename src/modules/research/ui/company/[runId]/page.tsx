import { RunInvestorClient } from "~/modules/research/ui/runs/[runId]/run-investor-client";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function CompanyResearchRunDetailPage({
  params,
}: PageProps) {
  const { runId } = await params;

  return <RunInvestorClient runId={runId} />;
}
