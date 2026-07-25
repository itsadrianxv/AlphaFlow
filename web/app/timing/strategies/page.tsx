import React from "react";
import { TimingStrategyEditor } from "~/app/timing/strategies/timing-strategy-editor";
import { requireAuth } from "~/server/auth/require-auth";

export default async function TimingStrategiesPage() {
  await requireAuth("/timing/strategies");

  return (
    <React.Suspense fallback={null}>
      <TimingStrategyEditor />
    </React.Suspense>
  );
}
