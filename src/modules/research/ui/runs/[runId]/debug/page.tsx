import { RunDetailClient } from "~/modules/research/ui/runs/[runId]/run-detail-client";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function WorkflowRunDebugPage({ params }: PageProps) {
  const { runId } = await params;

  return <RunDetailClient runId={runId} />;
}
