import React from "react";
import { WatchlistDetailClient } from "~/app/watchlists/[watchListId]/watchlist-detail-client";
import { requireAuth } from "~/server/auth/require-auth";

type PageProps = {
  params: Promise<{
    watchListId: string;
  }>;
};

export default async function WatchlistDetailPage({ params }: PageProps) {
  const { watchListId } = await params;
  await requireAuth(`/watchlists/${watchListId}`);

  return (
    <React.Suspense fallback={null}>
      <WatchlistDetailClient watchListId={watchListId} />
    </React.Suspense>
  );
}
