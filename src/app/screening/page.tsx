import React from "react";
import { buildScreeningRedirectTo } from "~/modules/screening/ui/access-control";
import { ScreeningLoginRedirectNotice } from "~/modules/screening/ui/screening-login-redirect-notice";
import { ScreeningStudioClient } from "~/modules/screening/ui/screening-studio-client";
import { auth } from "~/server/auth";

export default async function ScreeningPage(props: {
  searchParams?: Promise<{
    workspaceId?: string | string[];
  }>;
}) {
  const searchParams = props.searchParams
    ? await props.searchParams
    : undefined;
  const session = await auth();
  const redirectTo = buildScreeningRedirectTo(searchParams);

  if (!session?.user) {
    return <ScreeningLoginRedirectNotice redirectTo={redirectTo} />;
  }

  return (
    <React.Suspense fallback={null}>
      <ScreeningStudioClient />
    </React.Suspense>
  );
}
