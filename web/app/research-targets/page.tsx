import { Suspense } from "react";
import { ResearchTargetsClient } from "~/app/research-targets/research-targets-client";

export default function ResearchTargetsPage() {
  return (
    <Suspense fallback={null}>
      <ResearchTargetsClient />
    </Suspense>
  );
}
