import { RunDetailClient } from "~/app/workflows/[runId]/run-detail-client";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function WorkflowRunDetailPage({ params }: PageProps) {
  const { runId } = await params;

  return <RunDetailClient runId={runId} />;
}
