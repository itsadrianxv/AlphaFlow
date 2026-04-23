import { Suspense } from "react";

import { WorkflowsClient } from "~/modules/research/ui/industry/workflows-client";

export default function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowsClient />
    </Suspense>
  );
}
