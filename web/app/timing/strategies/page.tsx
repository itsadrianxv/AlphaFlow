import React from "react";
import { TimingStrategyEditor } from "~/app/timing/strategies/timing-strategy-editor";
import { TimingLoginRedirectNotice } from "~/app/timing/timing-login-redirect-notice";
import { auth } from "~/server/auth";

export default async function TimingStrategiesPage() {
  const session = await auth();
  if (!session?.user) {
    return <TimingLoginRedirectNotice redirectTo="/timing/strategies" />;
  }
  return (
    <React.Suspense fallback={null}>
      <TimingStrategyEditor />
    </React.Suspense>
  );
}
