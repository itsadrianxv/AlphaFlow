import React from "react";
import { SpaceDetailClient } from "~/modules/research/ui/spaces/[spaceId]/space-detail-client";
import { ScreeningLoginRedirectNotice } from "~/modules/screening/ui/screening-login-redirect-notice";
import { auth } from "~/server/auth";

type PageProps = {
  params: Promise<{
    spaceId: string;
  }>;
};

export default async function SpaceDetailPage({ params }: PageProps) {
  const session = await auth();
  const { spaceId } = await params;

  if (!session?.user) {
    return (
      <ScreeningLoginRedirectNotice
        redirectTo={`/research/spaces/${spaceId}`}
      />
    );
  }

  return (
    <React.Suspense fallback={null}>
      <SpaceDetailClient spaceId={spaceId} />
    </React.Suspense>
  );
}
