import { Suspense } from "react";

import { AgentRuntimeClientPage } from "~/app/agent-runtime/agent-runtime-client";
import { requireAuth } from "~/server/auth/require-auth";
import { HydrateClient } from "~/trpc/server";

export default async function AgentRuntimePage() {
  await requireAuth("/agent-runtime");

  return (
    <HydrateClient>
      <Suspense fallback={null}>
        <AgentRuntimeClientPage />
      </Suspense>
    </HydrateClient>
  );
}
