import { Suspense } from "react";
import { AgentRuntimeClientPage } from "~/app/agent-runtime/agent-runtime-client";

export default function AgentRuntimePage() {
  return (
    <Suspense fallback={null}>
      <AgentRuntimeClientPage />
    </Suspense>
  );
}
