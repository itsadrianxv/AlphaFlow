import { Suspense } from "react";

import { HighlightToNote } from "~/app/_components/highlight-to-note";
import { HomePageSnapshotProvider } from "~/app/_components/home-page-snapshot-provider";
import { HomepageMarketBaselineWorkspace } from "~/app/_components/market-baseline-workspace";
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
        <HomePageSnapshotProvider>
          <HighlightToNote floatingToolbar source={{ kind: "overview" }}>
            <HomepageMarketBaselineWorkspace />
          </HighlightToNote>
        </HomePageSnapshotProvider>
        {signedIn ? (
          <div className="pb-[144px]">
            <Suspense fallback={null}>
              <PiAgentComposer showConversation={false} />
            </Suspense>
          </div>
        ) : null}
      </WorkspaceShell>
    </HydrateClient>
  );
}
