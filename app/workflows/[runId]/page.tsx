import { redirect } from "next/navigation";

import { RunInvestorClient } from "~/app/workflows/[runId]/run-investor-client";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

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
      redirect(`/company-research/${runId}`);
    }
  }

  return <RunInvestorClient runId={runId} />;
}
