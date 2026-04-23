import React from "react";
import { TimingClient } from "~/modules/timing/ui/timing-client";
import { TimingLoginRedirectNotice } from "~/modules/timing/ui/timing-login-redirect-notice";
import { auth } from "~/server/auth";

export default async function TimingPage() {
  const session = await auth();

  if (!session?.user) {
    return <TimingLoginRedirectNotice redirectTo="/timing" />;
  }

  return (
    <React.Suspense fallback={null}>
      <TimingClient />
    </React.Suspense>
  );
}
