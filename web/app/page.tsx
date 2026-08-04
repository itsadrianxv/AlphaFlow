import { Suspense } from "react";

import { HomePageSnapshotProvider } from "~/app/_components/home-page-snapshot-provider";
import { OverviewWorkspace } from "~/app/_components/overview-workspace";
import { WorkspaceShell } from "~/app/_components/ui";
import { PiAgentComposer } from "~/app/agent-runtime/agent-runtime-client";
import { requireAuth } from "~/server/auth/require-auth";
import { HydrateClient } from "~/trpc/server";

export default async function Home() {
  const session = await requireAuth("/");
  const signedIn = Boolean(session.user);

  return (
    <HydrateClient>
      <WorkspaceShell section="home" showHistory={false}>
        <HomePageSnapshotProvider showRefreshStatus={false}>
          <OverviewWorkspace signedIn={signedIn} />
        </HomePageSnapshotProvider>
        {signedIn ? (
          <Suspense fallback={null}>
            <PiAgentComposer showConversation={false} />
          </Suspense>
        ) : null}
      </WorkspaceShell>
    </HydrateClient>
  );
}
