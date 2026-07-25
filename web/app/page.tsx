import { Suspense } from "react";
import { ImpactMappingWorkspace } from "~/app/_components/impact-mapping-workspace";
import { MarketContextSection } from "~/app/_components/market-context-section";
import { WorkspaceShell } from "~/app/_components/ui";
import { PiAgentComposer } from "~/app/agent-runtime/agent-runtime-client";
import { MarketHeatmapClient } from "~/app/heatmap/market-heatmap-client";
import { auth } from "~/server/auth";
import { HydrateClient } from "~/trpc/server";

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <HydrateClient>
      <WorkspaceShell section="home">
        <div className="pb-[264px]">
          <div className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              {signedIn ? <MarketHeatmapClient /> : null}
              <ImpactMappingWorkspace signedIn={signedIn} />
              {signedIn ? <MarketContextSection section="home" /> : null}
            </div>
            <aside
              aria-hidden="true"
              className="hidden border-l border-[var(--app-border-soft)] xl:block"
            />
          </div>
        </div>
        {signedIn ? (
          <Suspense fallback={null}>
            <PiAgentComposer />
          </Suspense>
        ) : null}
      </WorkspaceShell>
    </HydrateClient>
  );
}
