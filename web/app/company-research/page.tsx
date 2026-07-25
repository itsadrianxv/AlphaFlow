import { Suspense } from "react";

import { CompanyResearchClient } from "~/app/company-research/company-research-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function CompanyResearchPage() {
  await requireAuth("/company-research");

  return (
    <Suspense fallback={null}>
      <CompanyResearchClient />
    </Suspense>
  );
}
