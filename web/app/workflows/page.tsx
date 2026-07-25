import { Suspense } from "react";

import { WorkflowsClient } from "~/app/workflows/workflows-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function WorkflowsPage() {
  await requireAuth("/workflows");

  return (
    <Suspense fallback={null}>
      <WorkflowsClient />
    </Suspense>
  );
}
