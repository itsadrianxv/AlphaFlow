import React from "react";
import { ScreeningLoginRedirectNotice } from "~/app/screening/screening-login-redirect-notice";
import { SpaceDetailClient } from "~/app/spaces/[spaceId]/space-detail-client";
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
    return <ScreeningLoginRedirectNotice redirectTo={`/spaces/${spaceId}`} />;
  }

  return (
    <React.Suspense fallback={null}>
      <SpaceDetailClient spaceId={spaceId} />
    </React.Suspense>
  );
}
