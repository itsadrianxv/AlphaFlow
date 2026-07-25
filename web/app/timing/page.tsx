import React from "react";
import { TimingRunConsole } from "~/app/timing/timing-run-console";
import { requireAuth } from "~/server/auth/require-auth";

export default async function TimingPage() {
  await requireAuth("/timing");

  return (
    <React.Suspense fallback={null}>
      <TimingRunConsole />
    </React.Suspense>
  );
}
