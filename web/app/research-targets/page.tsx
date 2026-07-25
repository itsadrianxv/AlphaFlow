import { Suspense } from "react";
import { ResearchTargetsClient } from "~/app/research-targets/research-targets-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ResearchTargetsPage() {
  await requireAuth("/research-targets");

  return (
    <Suspense fallback={null}>
      <ResearchTargetsClient />
    </Suspense>
  );
}
