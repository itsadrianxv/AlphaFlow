import { Suspense } from "react";

import { CompanyResearchClient } from "~/app/company-research/company-research-client";

export default function CompanyResearchPage() {
  return (
    <Suspense fallback={null}>
      <CompanyResearchClient />
    </Suspense>
  );
}
