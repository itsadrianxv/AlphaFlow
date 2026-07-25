import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";

export function buildLoginHref(redirectTo: string) {
  const params = new URLSearchParams({
    redirectTo: resolveAuthRedirect(redirectTo),
  });

  return `/login?${params.toString()}`;
}

export async function requireAuth(redirectTo: string) {
  const session = await auth();

  if (!session?.user) {
    redirect(buildLoginHref(redirectTo));
  }

  return session;
}
