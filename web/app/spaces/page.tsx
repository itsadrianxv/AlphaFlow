import React from "react";
import { ScreeningLoginRedirectNotice } from "~/app/screening/screening-login-redirect-notice";
import { SpacesClient } from "~/app/spaces/spaces-client";
import { auth } from "~/server/auth";

export default async function SpacesPage() {
  const session = await auth();

  if (!session?.user) {
    return <ScreeningLoginRedirectNotice redirectTo="/spaces" />;
  }

  return (
    <React.Suspense fallback={null}>
      <SpacesClient />
    </React.Suspense>
  );
}
