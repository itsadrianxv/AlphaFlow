import { RunDetailClient } from "~/app/workflows/[runId]/run-detail-client";
import { requireAuth } from "~/server/auth/require-auth";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function WorkflowRunDebugPage({ params }: PageProps) {
  const { runId } = await params;
  await requireAuth(`/workflows/${runId}/debug`);

  return <RunDetailClient runId={runId} />;
}
