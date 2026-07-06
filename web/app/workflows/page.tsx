import { Suspense } from "react";

import { WorkflowsClient } from "~/app/workflows/workflows-client";

export default function WorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowsClient />
    </Suspense>
  );
}
