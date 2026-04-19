/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { Suspense } from "react";
import { OpportunityIntelligenceClient } from "~/app/opportunity-intelligence/opportunity-intelligence-client";

export default function OpportunityIntelligencePage() {
  return (
    <Suspense fallback={null}>
      <OpportunityIntelligenceClient />
    </Suspense>
  );
}
