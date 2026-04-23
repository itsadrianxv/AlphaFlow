import React from "react";
import { ScreeningLoginRedirectNotice } from "~/modules/screening/ui/screening-login-redirect-notice";
import { WatchlistsClient } from "~/modules/watchlist/ui/watchlists-client";
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
