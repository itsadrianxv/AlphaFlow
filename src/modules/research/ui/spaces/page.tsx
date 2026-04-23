import React from "react";
import { SpacesClient } from "~/modules/research/ui/spaces/spaces-client";
import { ScreeningLoginRedirectNotice } from "~/modules/screening/ui/screening-login-redirect-notice";
import { auth } from "~/server/auth";

export default async function SpacesPage() {
  const session = await auth();

  if (!session?.user) {
    return <ScreeningLoginRedirectNotice redirectTo="/research/spaces" />;
  }

  return (
    <React.Suspense fallback={null}>
      <SpacesClient />
    </React.Suspense>
  );
}
