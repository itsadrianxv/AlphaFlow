import { redirect } from "next/navigation";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/modules/research/server/domain/workflow/types";
import { RunInvestorClient } from "~/modules/research/ui/runs/[runId]/run-investor-client";
import { db } from "~/platform/db";
import { auth } from "~/server/auth";

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function WorkflowRunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  const session = await auth();

  if (session?.user?.id) {
    const run = await db.workflowRun.findFirst({
      where: {
        id: runId,
        userId: session.user.id,
      },
      select: {
        template: {
          select: {
            code: true,
          },
        },
      },
    });

    if (run?.template.code === COMPANY_RESEARCH_TEMPLATE_CODE) {
      redirect(`/research/runs/${runId}`);
    }
  }

  return <RunInvestorClient runId={runId} />;
}
