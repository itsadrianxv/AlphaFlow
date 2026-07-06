import React from "react";
import { ScreeningLoginRedirectNotice } from "~/app/screening/screening-login-redirect-notice";
import { WatchlistsClient } from "~/app/watchlists/watchlists-client";
import { auth } from "~/server/auth";

export default async function WatchlistsPage() {
  const session = await auth();

  if (!session?.user) {
    return <ScreeningLoginRedirectNotice redirectTo="/watchlists" />;
  }

  return (
    <React.Suspense fallback={null}>
      <WatchlistsClient />
    </React.Suspense>
  );
}
