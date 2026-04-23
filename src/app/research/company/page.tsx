import { Suspense } from "react";

import { CompanyResearchClient } from "~/modules/research/ui/company/company-research-client";

export default function ResearchCompanyPage() {
  return (
    <Suspense fallback={null}>
      <CompanyResearchClient />
    </Suspense>
  );
}
