import React from "react";
import { buildScreeningRedirectTo } from "~/app/screening/access-control";
import { ScreeningStudioClient } from "~/app/screening/screening-studio-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ScreeningPage(props: {
  searchParams?: Promise<{
    workspaceId?: string | string[];
  }>;
}) {
  const searchParams = props.searchParams
    ? await props.searchParams
    : undefined;
  const redirectTo = buildScreeningRedirectTo(searchParams);
  await requireAuth(redirectTo);

  return (
    <React.Suspense fallback={null}>
      <ScreeningStudioClient />
    </React.Suspense>
  );
}
