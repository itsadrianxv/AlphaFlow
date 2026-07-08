import { Suspense } from "react";
import { ResearchTargetsClient } from "~/app/research-targets/research-targets-client";
import { ScreeningLoginRedirectNotice } from "~/app/screening/screening-login-redirect-notice";
import { auth } from "~/server/auth";

export default async function ResearchTargetsPage() {
  const session = await auth();

  if (!session?.user) {
    return <ScreeningLoginRedirectNotice redirectTo="/research-targets" />;
  }

  return (
    <Suspense fallback={null}>
      <ResearchTargetsClient />
    </Suspense>
  );
}
