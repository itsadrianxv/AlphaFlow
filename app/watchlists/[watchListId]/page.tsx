import React from "react";
import { ScreeningLoginRedirectNotice } from "~/app/screening/screening-login-redirect-notice";
import { WatchlistDetailClient } from "~/app/watchlists/[watchListId]/watchlist-detail-client";
import { auth } from "~/server/auth";

type PageProps = {
  params: Promise<{
    watchListId: string;
  }>;
};

export default async function WatchlistDetailPage({ params }: PageProps) {
  const session = await auth();
  const { watchListId } = await params;

  if (!session?.user) {
    return (
      <ScreeningLoginRedirectNotice redirectTo={`/watchlists/${watchListId}`} />
    );
  }

  return (
    <React.Suspense fallback={null}>
      <WatchlistDetailClient watchListId={watchListId} />
    </React.Suspense>
  );
}
