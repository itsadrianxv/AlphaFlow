import { Suspense } from "react";

import { ResearchInboxPrototype } from "~/app/research-inbox/prototype/research-inbox-prototype";

export default function ResearchInboxPrototypePage() {
  return (
    <Suspense fallback={null}>
      <ResearchInboxPrototype />
    </Suspense>
  );
}
